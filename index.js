const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const config = require('./config');

const app = express();
const port = config.server.port;

// Initialize database
const db = new sqlite3.Database(config.database.filename, (err) => {
    if (err) {
        console.error('Error opening database:', err);
        return;
    }
    console.log('Connected to SQLite database');

    // Create system_logs table for tracking all actions
    db.run(`CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
        user TEXT NOT NULL,
        action_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        details TEXT,
        ip_address TEXT,
        old_values TEXT,
        new_values TEXT
    )`, (err) => {
        if (err) {
            console.error('Error creating system_logs table:', err);
            return;
        }
        console.log('System logs table ready');
    });

    // Create register_config table for storing register settings
    db.run(`CREATE TABLE IF NOT EXISTS register_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_amount DECIMAL(10,2) NOT NULL,
        last_modified DATETIME DEFAULT (datetime('now', 'localtime')),
        modified_by TEXT NOT NULL
    )`, (err) => {
        if (err) {
            console.error('Error creating register_config table:', err);
            return;
        }
        console.log('Register config table ready');

        // Initialize with default base amount if empty
        db.get('SELECT * FROM register_config', [], (err, row) => {
            if (err) {
                console.error('Error checking register config:', err);
                return;
            }
            if (!row) {
                db.run(`INSERT INTO register_config (base_amount, modified_by) VALUES (?, ?)`,
                    [300.00, 'system'],
                    (err) => {
                        if (err) {
                            console.error('Error initializing register config:', err);
                            return;
                        }
                        console.log('Register config initialized with default base amount');
                    }
                );
            }
        });
    });

    // Create fiscal_periods table first as it's fundamental to the system
    db.run(`CREATE TABLE IF NOT EXISTS fiscal_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        current_date DATE NOT NULL,
        closure_number INTEGER NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        closed_at DATETIME
    )`, (err) => {
        if (err) {
            console.error('Error creating fiscal_periods table:', err);
            return;
        }
        console.log('Fiscal periods table ready');

        // Check if there's an active fiscal period
        db.get(`SELECT * FROM fiscal_periods WHERE status = 'ACTIVE'`, [], (err, row) => {
            if (err) {
                console.error('Error checking fiscal periods:', err);
                return;
            }

            if (!row) {
                // Initialize with first fiscal period if none exists
                db.run(`INSERT INTO fiscal_periods (current_date, closure_number, status) 
                       VALUES (datetime('now', 'localtime'), 1, 'ACTIVE')`, (err) => {
                    if (err) {
                        console.error('Error initializing fiscal period:', err);
                        return;
                    }
                    console.log('Initial fiscal period created');
                });
            }
        });
    });

    // Create transactions table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
        fiscal_date DATE,
        amount DECIMAL(10,2) NOT NULL,
        payment_method TEXT NOT NULL,
        payment_type TEXT NOT NULL,
        card_last_digits TEXT,
        description TEXT,
        user TEXT DEFAULT 'system'
    )`, (err) => {
        if (err) {
            console.error('Error creating transactions table:', err);
            return;
        }
        console.log('Transactions table ready');

        // Check if columns exist
        db.all("PRAGMA table_info(transactions)", [], (err, rows) => {
            if (err) {
                console.error('Error checking transactions table schema:', err);
                return;
            }
            
            const hasDescription = rows.some(row => row.name === 'description');
            const hasFiscalDate = rows.some(row => row.name === 'fiscal_date');
            
            db.serialize(() => {
                // Add description column if missing
                if (!hasDescription) {
                    console.log('Description column not found, adding it...');
                    db.run("ALTER TABLE transactions ADD COLUMN description TEXT", (err) => {
                        if (err) {
                            console.error('Error adding description column:', err);
                            return;
                        }
                        console.log('Added description column to transactions table');
                    });
                }

                // Add fiscal_date column if missing
                if (!hasFiscalDate) {
                    console.log('Fiscal date column not found in transactions, adding it...');
                    db.run("ALTER TABLE transactions ADD COLUMN fiscal_date DATE", (err) => {
                        if (err) {
                            console.error('Error adding fiscal_date column to transactions:', err);
                            return;
                        }
                        console.log('Added fiscal_date column to transactions table');
                        
                        // Update existing rows to set fiscal_date to their timestamp date
                        db.run(`UPDATE transactions 
                               SET fiscal_date = date(timestamp) 
                               WHERE fiscal_date IS NULL`, (err) => {
                            if (err) {
                                console.error('Error updating existing fiscal_date values in transactions:', err);
                                return;
                            }
                            console.log('Updated existing transactions with fiscal_date values');
                        });
                    });
                }
            });
        });
    });

    // Create users table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )`, (err) => {
        if (err) {
            console.error('Error creating users table:', err);
            return;
        }
        console.log('Users table ready');

        // Create default admin user if it doesn't exist
        const checkAdmin = `SELECT * FROM users WHERE username = 'admin'`;
        db.get(checkAdmin, [], (err, row) => {
            if (err) {
                console.error('Error checking admin user:', err);
                return;
            }
            if (!row) {
                db.run(`INSERT INTO users (username, password) VALUES (?, ?)`,
                    ['admin', 'admin123'],
                    (err) => {
                        if (err) {
                            console.error('Error creating admin user:', err);
                            return;
                        }
                        console.log('Default admin user created');
                    }
                );
            }
        });
    });

    // Create separate invoice payments table
    db.run(`CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
        fiscal_date DATE,
        amount DECIMAL(10,2) NOT NULL,
        date_issued DATE NOT NULL,
        recipient_name TEXT NOT NULL,
        vat_number TEXT,
        status TEXT NOT NULL,
        user TEXT DEFAULT 'system'
    )`, (err) => {
        if (err) {
            console.error('Error creating invoices table:', err);
            return;
        }
        console.log('Invoices table ready');

        // Check if fiscal_date column exists
        db.all("PRAGMA table_info(invoices)", [], (err, rows) => {
            if (err) {
                console.error('Error checking invoices table schema:', err);
                return;
            }
            
            const hasFiscalDate = rows.some(row => row.name === 'fiscal_date');
            if (!hasFiscalDate) {
                console.log('Fiscal date column not found in invoices, adding it...');
                db.run("ALTER TABLE invoices ADD COLUMN fiscal_date DATE", (err) => {
                    if (err) {
                        console.error('Error adding fiscal_date column to invoices:', err);
                        return;
                    }
                    console.log('Added fiscal_date column to invoices table');
                    
                    // Update existing rows to set fiscal_date to their timestamp date
                    db.run(`UPDATE invoices 
                           SET fiscal_date = date(timestamp) 
                           WHERE fiscal_date IS NULL`, (err) => {
                        if (err) {
                            console.error('Error updating existing fiscal_date values in invoices:', err);
                            return;
                        }
                        console.log('Updated existing invoices with fiscal_date values');
                    });
                });
            }
        });
    });

    // Create debts table
    db.run(`CREATE TABLE IF NOT EXISTS debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
        fiscal_date DATE,
        person_name TEXT NOT NULL,
        amount_taken DECIMAL(10,2) NOT NULL,
        amount_returned DECIMAL(10,2) DEFAULT 0,
        invoice_amount DECIMAL(10,2) DEFAULT 0,
        description TEXT,
        status TEXT DEFAULT 'PENDING',
        user TEXT DEFAULT 'system'
    )`, (err) => {
        if (err) {
            console.error('Error creating debts table:', err);
            return;
        }
        console.log('Debts table ready');

        // Check if fiscal_date column exists
        db.all("PRAGMA table_info(debts)", [], (err, rows) => {
            if (err) {
                console.error('Error checking debts table schema:', err);
                return;
            }
            
            const hasFiscalDate = rows.some(row => row.name === 'fiscal_date');
            if (!hasFiscalDate) {
                console.log('Fiscal date column not found in debts, adding it...');
                db.run("ALTER TABLE debts ADD COLUMN fiscal_date DATE", (err) => {
                    if (err) {
                        console.error('Error adding fiscal_date column to debts:', err);
                        return;
                    }
                    console.log('Added fiscal_date column to debts table');
                    
                    // Update existing rows to set fiscal_date to their timestamp date
                    db.run(`UPDATE debts 
                           SET fiscal_date = date(timestamp) 
                           WHERE fiscal_date IS NULL`, (err) => {
                        if (err) {
                            console.error('Error updating existing fiscal_date values in debts:', err);
                            return;
                        }
                        console.log('Updated existing debts with fiscal_date values');
                    });
                });
            }
        });
    });

    // Create station closures table
    db.run(`CREATE TABLE IF NOT EXISTS station_closures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
        fiscal_date DATE,
        station TEXT NOT NULL,
        grand_total DECIMAL(10,2) NOT NULL,
        room_charges DECIMAL(10,2) DEFAULT 0,
        complementary DECIMAL(10,2) DEFAULT 0,
        net_amount DECIMAL(10,2) NOT NULL,
        user TEXT DEFAULT 'system',
        status TEXT DEFAULT 'PENDING'
    )`, (err) => {
        if (err) {
            console.error('Error creating station_closures table:', err);
            return;
        }
        console.log('Station closures table ready');

        // Check if fiscal_date column exists
        db.all("PRAGMA table_info(station_closures)", [], (err, rows) => {
            if (err) {
                console.error('Error checking station_closures table schema:', err);
                return;
            }
            
            // Check if fiscal_date column exists
            const hasFiscalDate = rows.some(row => row.name === 'fiscal_date');
            if (!hasFiscalDate) {
                console.log('Fiscal date column not found, adding it...');
                db.serialize(() => {
                    db.run("ALTER TABLE station_closures ADD COLUMN fiscal_date DATE", (err) => {
                        if (err) {
                            console.error('Error adding fiscal_date column:', err);
                            return;
                        }
                        console.log('Added fiscal_date column to station_closures table');
                        
                        // Update existing rows to set fiscal_date to their timestamp date
                        db.run(`UPDATE station_closures 
                               SET fiscal_date = date(timestamp) 
                               WHERE fiscal_date IS NULL`, (err) => {
                            if (err) {
                                console.error('Error updating existing fiscal_date values:', err);
                                return;
                            }
                            console.log('Updated existing rows with fiscal_date values');
                        });
                    });
                });
            } else {
                console.log('Fiscal date column already exists');
            }
        });
    });
});

app.use(bodyParser.json());
app.use(express.static('public'));

// Authentication middleware
function requireAuth(req, res, next) {
    // Skip auth for login page and API
    if (req.path === '/login' || req.path === '/api/login') {
        return next();
    }

    // Only check auth for API endpoints
    if (req.path.startsWith('/api/')) {
        const username = req.headers['x-user'];
        if (!username) {
            return res.status(401).json({ status: 'ERROR', message: 'Authentication required' });
        }

        // Verify user exists
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
            if (err || !row) {
                return res.status(401).json({ status: 'ERROR', message: 'Invalid user' });
            }
            next();
        });
    } else {
        // Allow all non-API routes without auth
        next();
    }
}

// Apply authentication middleware
app.use(requireAuth);

// Login route
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Username and password are required'
        });
    }

    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({
                status: 'ERROR',
                message: 'Internal server error'
            });
        }

        if (!row) {
            return res.status(401).json({
                status: 'ERROR',
                message: 'Invalid username or password'
            });
        }

        res.json({
            status: 'SUCCESS',
            message: 'Login successful'
        });
    });
});

class CashRegister {
    constructor() {
        this.defaultDrawer = config.register.drawer;
        this.baseAmount = config.register.baseAmount;
        this.initializeDrawer();
    }

    initializeDrawer() {
        // Create table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS drawer_contents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            denomination TEXT NOT NULL,
            value REAL NOT NULL,
            quantity INTEGER NOT NULL,
            UNIQUE(denomination)
        )`, (err) => {
            if (err) {
                console.error('Error creating drawer_contents table:', err);
                return;
            }
            console.log('Drawer contents table ready');

            // Check if drawer is empty and initialize with default values if needed
            db.get('SELECT COUNT(*) as count FROM drawer_contents', [], (err, row) => {
                if (err) {
                    console.error('Error checking drawer contents:', err);
                    return;
                }

                if (row.count === 0) {
                    // Insert default values
                    console.log('Initializing drawer with default values...');
                    const stmt = db.prepare('INSERT INTO drawer_contents (denomination, value, quantity) VALUES (?, ?, ?)');
                    Object.entries(this.defaultDrawer).forEach(([denomination, data]) => {
                        stmt.run(denomination, data.value, data.quantity);
                    });
                    stmt.finalize();
                    console.log('Drawer initialized with default values');
                } else {
                    console.log('Drawer already contains data, skipping initialization');
                }
            });
        });
    }

    async getDrawerTotal() {
        return new Promise((resolve, reject) => {
            db.all('SELECT value, quantity FROM drawer_contents', [], (err, rows) => {
                if (err) {
                    console.error('Error getting drawer total:', err);
                    reject(err);
                    return;
                }

                const total = rows.reduce((sum, row) => {
                    return sum + (row.value * row.quantity);
                }, 0);

                resolve(total.toFixed(2));
            });
        });
    }

    async getDrawerContents() {
        return new Promise((resolve, reject) => {
            db.all('SELECT denomination, value, quantity FROM drawer_contents', [], (err, rows) => {
                if (err) {
                    console.error('Error getting drawer contents:', err);
                    reject(err);
                    return;
                }

                const contents = {};
                rows.forEach(row => {
                    contents[row.denomination] = {
                        value: row.value,
                        quantity: row.quantity
                    };
                });

                resolve(contents);
            });
        });
    }

    async updateDrawerContents(contents) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                const stmt = db.prepare('UPDATE drawer_contents SET quantity = ? WHERE denomination = ?');
                
                try {
                    db.run('BEGIN TRANSACTION');
                    
                    Object.entries(contents).forEach(([denomination, data]) => {
                        stmt.run(data.quantity, denomination);
                    });
                    
                    db.run('COMMIT');
                    stmt.finalize();
                    resolve();
                } catch (error) {
                    db.run('ROLLBACK');
                    console.error('Error updating drawer contents:', error);
                    reject(error);
                }
            });
        });
    }

    async makeTransaction(amount, paymentMethod, paymentType, cardLastDigits = null, invoiceDetails = null, req = null) {
        return new Promise(async (resolve, reject) => {
            const username = req?.headers?.['x-user'] || 'system';

            try {
                // Start transaction
                await new Promise((res, rej) => {
                    db.run('BEGIN TRANSACTION', err => {
                        if (err) rej(err);
                        else res();
                    });
                });

                if (paymentMethod === 'card') {
                    if (!cardLastDigits || cardLastDigits.length !== 4) {
                        resolve({ 
                            status: 'ERROR', 
                            message: 'Invalid card details. Please provide last 4 digits.' 
                        });
                        return;
                    }
                }

                if (paymentMethod === 'invoice') {
                    if (!invoiceDetails || !invoiceDetails.recipientName || !invoiceDetails.dateIssued) {
                        resolve({
                            status: 'ERROR',
                            message: 'Invalid invoice details. Please provide recipient name and date issued.'
                        });
                        return;
                    }

                    const sql = `INSERT INTO invoices 
                        (amount, date_issued, recipient_name, vat_number, status, user, fiscal_date) 
                        VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`;
                    
                    const result = await new Promise((res, rej) => {
                        db.run(sql, [
                            amount,
                            invoiceDetails.dateIssued,
                            invoiceDetails.recipientName,
                            invoiceDetails.vatNumber || null,
                            'SUCCESS',
                            username
                        ], function(err) {
                            if (err) rej(err);
                            else res(this);
                        });
                    });

                    // Log the invoice creation
                    await logAction(
                        username,
                        'CREATE',
                        'INVOICE',
                        result.lastID,
                        `Created invoice for ${invoiceDetails.recipientName} (${amount}€)`,
                        req || { ip: 'system' },
                        null,
                        {
                            amount,
                            recipient: invoiceDetails.recipientName,
                            date_issued: invoiceDetails.dateIssued,
                            vat_number: invoiceDetails.vatNumber,
                            timestamp: new Date().toISOString()
                        }
                    );

                    await new Promise((res, rej) => {
                        db.run('COMMIT', err => {
                            if (err) rej(err);
                            else res();
                        });
                    });

                    resolve({ 
                        status: 'SUCCESS',
                        message: `Invoice payment processed successfully: €${amount} to ${invoiceDetails.recipientName}`,
                        transactionId: result.lastID
                    });
                    return;
                }

                // Handle cash and card payments
                const sql = `INSERT INTO transactions 
                    (amount, payment_method, payment_type, card_last_digits, user, fiscal_date) 
                    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`;
                
                const result = await new Promise((res, rej) => {
                    db.run(sql, [
                        amount,
                        paymentMethod,
                        paymentType,
                        cardLastDigits,
                        username
                    ], function(err) {
                        if (err) rej(err);
                        else res(this);
                    });
                });

                // Log the transaction
                await logAction(
                    username,
                    'CREATE',
                    'TRANSACTION',
                    result.lastID,
                    `Created ${paymentMethod} transaction for ${amount}€`,
                    req || { ip: 'system' },
                    null,
                    {
                        amount,
                        payment_method: paymentMethod,
                        payment_type: paymentType,
                        card_last_digits: cardLastDigits,
                        timestamp: new Date().toISOString()
                    }
                );

                await new Promise((res, rej) => {
                    db.run('COMMIT', err => {
                        if (err) rej(err);
                        else res();
                    });
                });

                resolve({ 
                    status: 'SUCCESS',
                    message: `Transaction processed successfully: €${amount} via ${paymentMethod}`,
                    transactionId: result.lastID
                });
            } catch (error) {
                console.error('Error in transaction:', error);
                
                try {
                    await new Promise((res, rej) => {
                        db.run('ROLLBACK', err => {
                            if (err) rej(err);
                            else res();
                        });
                    });
                } catch (rollbackError) {
                    console.error('Error rolling back transaction:', rollbackError);
                }

                // Log the error
                await logAction(
                    username,
                    'ERROR',
                    'TRANSACTION',
                    null,
                    `Failed to create ${paymentMethod} transaction: ${error.message}`,
                    req || { ip: 'system' },
                    {
                        amount,
                        payment_method: paymentMethod,
                        payment_type: paymentType,
                        card_last_digits: cardLastDigits
                    },
                    null
                );

                reject({ 
                    status: 'ERROR',
                    message: 'Failed to process transaction'
                });
            }
        });
    }

    getTransactions(filters = {}) {
        return new Promise((resolve, reject) => {
            // First get all transactions to inspect them
            db.all('SELECT * FROM transactions', [], (err, allRows) => {
                if (err) {
                    console.error('Error getting all transactions:', err);
                } else {
                    console.log('All transactions in DB:', allRows);
                }
            });

            let sql = `SELECT * FROM transactions WHERE 1=1`;
            const params = [];

            // Debug logging
            console.log('Received filters:', filters);

            // Handle date range filter
            if (filters.dateRange) {
                const [startDate, endDate] = filters.dateRange.split(' to ');
                if (startDate && endDate) {
                    sql += ` AND date(timestamp) BETWEEN ? AND ?`;
                    params.push(startDate, endDate);
                }
            }

            // Handle payment method filter with detailed logging
            if (filters.paymentMethod) {
                sql += ` AND LOWER(payment_method) = LOWER(?)`;
                params.push(filters.paymentMethod);
                console.log('Filtering by payment method:', {
                    requestedMethod: filters.paymentMethod,
                    sqlQuery: sql,
                    params: params
                });
            }

            // Handle payment type filter
            if (filters.paymentType) {
                sql += ` AND payment_type = ?`;
                params.push(filters.paymentType);
            }

            // Handle search filter (search across multiple columns)
            if (filters.search) {
                const searchTerm = `%${filters.search}%`;
                sql += ` AND (payment_type LIKE ? OR card_last_digits LIKE ? OR CAST(amount AS TEXT) LIKE ?)`;
                params.push(searchTerm, searchTerm, searchTerm);
            }

            sql += ` ORDER BY timestamp DESC`;

            // Debug logging
            console.log('Final SQL:', sql);
            console.log('Final params:', params);

            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('Error fetching transactions:', err);
                    reject(err);
                    return;
                }
                // Debug logging
                console.log('Query results:', {
                    rowCount: rows.length,
                    rows: rows
                });
                resolve(rows);
            });
        });
    }

    getInvoices(limit = 50) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM invoices ORDER BY timestamp DESC LIMIT ?`;
            db.all(sql, [limit], (err, rows) => {
                if (err) {
                    console.error('Error fetching invoices:', err);
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }

    updateTransaction(id, updates) {
        return new Promise((resolve, reject) => {
            // Validate required fields
            if (!updates.amount || isNaN(updates.amount) || updates.amount <= 0) {
                reject({ status: 'ERROR', message: 'Invalid amount' });
                return;
            }

            if (!updates.payment_method || !['cash', 'card'].includes(updates.payment_method.toLowerCase())) {
                reject({ status: 'ERROR', message: 'Invalid payment method' });
                return;
            }

            if (!updates.payment_type) {
                reject({ status: 'ERROR', message: 'Payment type is required' });
                return;
            }

            // Validate card last digits based on payment method
            if (updates.payment_method.toLowerCase() === 'card') {
                if (!updates.card_last_digits || !/^\d{4}$/.test(updates.card_last_digits)) {
                    reject({ status: 'ERROR', message: 'Card payments require valid last 4 digits' });
                    return;
                }
            } else {
                // For cash payments, ensure no card digits are present
                updates.card_last_digits = null;
            }

            const sql = `UPDATE transactions 
                SET amount = ?, 
                    payment_method = ?, 
                    payment_type = ?, 
                    card_last_digits = ?
                WHERE id = ?`;

            db.run(sql, [
                updates.amount,
                updates.payment_method.toLowerCase(),
                updates.payment_type,
                updates.card_last_digits,
                id
            ], function(err) {
                if (err) {
                    console.error('Error updating transaction:', err);
                    reject({ status: 'ERROR', message: 'Failed to update transaction' });
                    return;
                }

                if (this.changes === 0) {
                    reject({ status: 'ERROR', message: 'Transaction not found' });
                    return;
                }

                resolve({ 
                    status: 'SUCCESS',
                    message: 'Transaction updated successfully'
                });
            });
        });
    }
}

const register = new CashRegister();

// API Routes
app.get('/api/drawer', async (req, res) => {
    try {
        const [total, contents] = await Promise.all([
            register.getDrawerTotal(),
            register.getDrawerContents()
        ]);

        res.json({
            total,
            contents
        });
    } catch (error) {
        console.error('Error getting drawer data:', error);
        res.status(500).json({
            status: 'ERROR',
            message: 'Failed to get register contents'
        });
    }
});

app.put('/api/drawer', async (req, res) => {
    const { contents } = req.body;
    
    if (!contents) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Contents are required'
        });
    }

    try {
        await register.updateDrawerContents(contents);
        const [total, updatedContents] = await Promise.all([
            register.getDrawerTotal(),
            register.getDrawerContents()
        ]);

        res.json({
            status: 'SUCCESS',
            message: 'Register contents updated successfully',
            total,
            contents: updatedContents
        });
    } catch (error) {
        console.error('Error updating drawer contents:', error);
        res.status(500).json({
            status: 'ERROR',
            message: 'Failed to update register contents'
        });
    }
});

app.post('/api/transaction', async (req, res) => {
    try {
        const { amount, paymentMethod, paymentType, cardLastDigits, invoiceDetails } = req.body;
        const username = req.headers['x-user'] || 'system';

        const result = await register.makeTransaction(
            amount, 
            paymentMethod, 
            paymentType, 
            cardLastDigits,
            invoiceDetails,
            req
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            message: 'Failed to process transaction'
        });
    }
});

app.get('/api/transactions', async (req, res) => {
    try {
        const filters = {
            dateRange: req.query.dateRange,
            paymentMethod: req.query.paymentMethod,
            paymentType: req.query.paymentType,
            search: req.query.search
        };
        const transactions = await register.getTransactions(filters);
        res.json(transactions);
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            message: 'Failed to fetch transactions'
        });
    }
});

// Add endpoint to get invoice payments
app.get('/api/invoices', async (req, res) => {
    try {
        const payments = await register.getInvoices();
        res.json(payments);
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            message: 'Failed to fetch invoices'
        });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/transaction', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'transaction.html'));
});

app.get('/bulk-actions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bulk-actions.html'));
});

app.get('/bulk-transactions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bulk-transactions.html'));
});

app.get('/bulk-edit', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bulk-edit.html'));
});

app.get('/debts', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'debts.html'));
});

// Add endpoint for bulk transactions
app.post('/api/bulk-transactions', async (req, res) => {
    try {
        const transactions = req.body;
        const results = [];
        let hasError = false;

        for (const transaction of transactions) {
            try {
                const result = await register.makeTransaction(
                    transaction.amount,
                    transaction.paymentMethod,
                    transaction.paymentType,
                    transaction.cardLastDigits || null
                );
                results.push({
                    status: 'SUCCESS',
                    message: result.message,
                    row: transaction.row
                });
            } catch (error) {
                hasError = true;
                results.push({
                    status: 'ERROR',
                    message: error.message || 'Failed to process transaction',
                    row: transaction.row
                });
            }
        }

        res.json({
            status: hasError ? 'PARTIAL' : 'SUCCESS',
            results: results
        });
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            message: 'Failed to process bulk transactions'
        });
    }
});

// Add PUT endpoint for updating transactions
app.put('/api/transactions/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const updates = req.body;
        
        const result = await register.updateTransaction(id, updates);
        res.json(result);
    } catch (error) {
        res.status(error.status === 'ERROR' ? 400 : 500).json({
            status: 'ERROR',
            message: error.message || 'Failed to update transaction'
        });
    }
});

// Add new user (protected route)
app.post('/api/users', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Username and password are required'
        });
    }

    db.run('INSERT INTO users (username, password) VALUES (?, ?)',
        [username, password],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({
                        status: 'ERROR',
                        message: 'Username already exists'
                    });
                }
                console.error('Database error:', err);
                return res.status(500).json({
                    status: 'ERROR',
                    message: 'Failed to create user'
                });
            }

            res.json({
                status: 'SUCCESS',
                message: 'User created successfully',
                userId: this.lastID
            });
        }
    );
});

// Add new API endpoints for debts
// Create a function to handle debt operations
async function createDebt(person_name, amount_taken, description, username, req) {
    const sql = `INSERT INTO debts (person_name, amount_taken, description, user, fiscal_date) 
                 VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`;

    try {
        // Start transaction
        await new Promise((resolve, reject) => {
            db.run('BEGIN TRANSACTION', err => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Insert debt record
        const result = await new Promise((resolve, reject) => {
            db.run(sql, [person_name, amount_taken, description, username], function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });

        // Log the debt creation
        await logAction(
            username,
            'CREATE',
            'DEBT',
            result.lastID,
            `Created debt record for ${person_name} (${amount_taken}€)`,
            req,
            null,
            {
                person_name,
                amount_taken,
                description,
                timestamp: new Date().toISOString()
            }
        );

        // Commit transaction
        await new Promise((resolve, reject) => {
            db.run('COMMIT', err => {
                if (err) reject(err);
                else resolve();
            });
        });

        return {
            status: 'SUCCESS',
            message: 'Debt record created successfully',
            debtId: result.lastID
        };
    } catch (error) {
        console.error('Error creating debt record:', error);

        // Rollback transaction
        try {
            await new Promise((resolve, reject) => {
                db.run('ROLLBACK', err => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (rollbackError) {
            console.error('Error rolling back transaction:', rollbackError);
        }

        // Log the error
        await logAction(
            username,
            'ERROR',
            'DEBT',
            null,
            `Failed to create debt record for ${person_name}: ${error.message}`,
            req,
            { person_name, amount_taken, description },
            null
        );

        throw error;
    }
}

app.post('/api/debts', async (req, res) => {
    const { person_name, amount_taken, description } = req.body;
    const username = req.headers['x-user'] || 'system';
    
    if (!person_name || !amount_taken || amount_taken <= 0) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Person name and valid amount are required'
        });
    }

    try {
        const result = await createDebt(person_name, amount_taken, description, username, req);
        res.json(result);
    } catch (error) {
        return res.status(500).json({
            status: 'ERROR',
            message: 'Failed to create debt record'
        });
    }
});

app.get('/api/debts', (req, res) => {
    const sql = `SELECT * FROM debts ORDER BY 
                 CASE status 
                    WHEN 'PENDING' THEN 1 
                    WHEN 'PARTIALLY_RETURNED' THEN 2
                    ELSE 3 
                 END,
                 timestamp DESC`;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching debts:', err);
            return res.status(500).json({
                status: 'ERROR',
                message: 'Failed to fetch debts'
            });
        }

        res.json(rows);
    });
});

app.put('/api/debts/:id', async (req, res) => {
    const { amount_returned, invoice_amount, invoice_company } = req.body;
    const debtId = req.params.id;
    const username = req.headers['x-user'] || 'system';

    if (!debtId || (amount_returned === undefined && invoice_amount === undefined)) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Invalid update data'
        });
    }

    if (invoice_amount > 0 && !invoice_company) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Company name is required when using invoice amount'
        });
    }

    try {
        // Start transaction
        await new Promise((resolve, reject) => {
            db.run('BEGIN TRANSACTION', err => {
                if (err) reject(err);
                else resolve();
            });
        });

        // First get the current debt record
        const debt = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM debts WHERE id = ?', [debtId], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('Debt record not found'));
                else resolve(row);
            });
        });

        const new_amount_returned = amount_returned !== undefined ? amount_returned : debt.amount_returned;
        const new_invoice_amount = invoice_amount !== undefined ? invoice_amount : debt.invoice_amount;
        const total_returned = new_amount_returned + new_invoice_amount;

        // Determine the new status
        let status = 'PENDING';
        if (total_returned >= debt.amount_taken) {
            status = 'COMPLETED';
        } else if (total_returned > 0) {
            status = 'PARTIALLY_RETURNED';
        }

        // Update the debt record
        await new Promise((resolve, reject) => {
            const sql = `UPDATE debts 
                        SET amount_returned = ?,
                            invoice_amount = ?,
                            status = ?
                        WHERE id = ?`;

            db.run(sql, [new_amount_returned, new_invoice_amount, status, debtId], function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });

        // If there's an invoice amount, create an invoice record
        if (invoice_amount > 0) {
            const invoiceSql = `INSERT INTO invoices 
                (amount, date_issued, recipient_name, status, user, fiscal_date) 
                VALUES (?, datetime('now', 'localtime'), ?, 'SUCCESS', ?, datetime('now', 'localtime'))`;
            
            await new Promise((resolve, reject) => {
                db.run(invoiceSql, [invoice_amount, invoice_company, username], function(err) {
                    if (err) reject(err);
                    else resolve(this);
                });
            });
        }

        // Log the debt update
        await logAction(
            username,
            'UPDATE',
            'DEBT',
            debtId,
            `Updated debt record for ${debt.person_name}`,
            req,
            {
                amount_returned: debt.amount_returned,
                invoice_amount: debt.invoice_amount,
                status: debt.status
            },
            {
                amount_returned: new_amount_returned,
                invoice_amount: new_invoice_amount,
                invoice_company: invoice_company,
                status: status,
                timestamp: new Date().toISOString()
            }
        );

        await new Promise((resolve, reject) => {
            db.run('COMMIT', err => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.json({
            status: 'SUCCESS',
            message: 'Debt record updated successfully'
        });
    } catch (error) {
        console.error('Error updating debt record:', error);

        try {
            await new Promise((resolve, reject) => {
                db.run('ROLLBACK', err => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (rollbackError) {
            console.error('Error rolling back transaction:', rollbackError);
        }

        // Log the error
        await logAction(
            username,
            'ERROR',
            'DEBT',
            debtId,
            `Failed to update debt record: ${error.message}`,
            req,
            req.body,
            null
        );

        return res.status(error.message === 'Debt record not found' ? 404 : 500).json({
            status: 'ERROR',
            message: error.message || 'Failed to update debt record'
        });
    }
});

// Add route for register page
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Add route for station closure page
app.get('/station-closure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'station-closure.html'));
});

// Add API endpoint to get last station closure
app.get('/api/station-closure/:station', (req, res) => {
    const station = req.params.station;
    
    db.get(
        `SELECT * FROM station_closures 
         WHERE station = ? 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [station],
        (err, row) => {
            if (err) {
                console.error('Error fetching last station closure:', err);
                return res.status(500).json({
                    status: 'ERROR',
                    message: 'Failed to fetch station closure'
                });
            }
            
            res.json({
                status: 'SUCCESS',
                closure: row || null
            });
        }
    );
});

// Add API endpoint to update station closure
app.put('/api/station-closure/:id', async (req, res) => {
    const closureId = req.params.id;
    const { grandTotal, roomCharges, complementary, netAmount } = req.body;
    const username = req.headers['x-user'] || 'system';

    // Create a promise-based version of db.run
    const dbRun = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    try {
        console.log('Starting transaction for updating station closure');
        await dbRun('BEGIN TRANSACTION');

        // First get the original closure to compare
        const originalClosure = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM station_closures WHERE id = ?', [closureId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!originalClosure) {
            throw new Error('Station closure not found');
        }

        // Update the station closure
        console.log('Updating station closure');
        const updateResult = await dbRun(
            `UPDATE station_closures 
             SET grand_total = ?, 
                 room_charges = ?, 
                 complementary = ?, 
                 net_amount = ?,
                 user = ?
             WHERE id = ?`,
            [grandTotal, roomCharges || 0, complementary || 0, netAmount, username, closureId]
        );

        if (updateResult.changes === 0) {
            throw new Error('Station closure not found');
        }

        // Update or insert transactions
        // Main closure transaction
        await dbRun(
            `UPDATE transactions 
             SET amount = ?, 
                 user = ? 
             WHERE payment_method = 'station_closure' 
             AND description LIKE ?`,
            [grandTotal, username, `%closure (ID: ${closureId})`]
        );

        // Handle room charges
        if (roomCharges > 0) {
            await dbRun(
                `UPDATE transactions 
                 SET amount = ?, 
                     user = ? 
                 WHERE payment_method = 'room_charge' 
                 AND description LIKE ?`,
                [-roomCharges, username, `%charges (Closure ID: ${closureId})`]
            );
        }

        // Handle complementary
        if (complementary > 0) {
            await dbRun(
                `UPDATE transactions 
                 SET amount = ?, 
                     user = ? 
                 WHERE payment_method = 'complementary' 
                 AND description LIKE ?`,
                [-complementary, username, `%complementary (Closure ID: ${closureId})`]
            );
        }

        console.log('All updates completed successfully');
        await dbRun('COMMIT');

        res.json({
            status: 'SUCCESS',
            message: 'Station closure updated successfully'
        });
    } catch (error) {
        console.error('Error updating station closure:', error);
        try {
            await dbRun('ROLLBACK');
            console.log('Transaction rolled back successfully');
        } catch (rollbackError) {
            console.error('Error rolling back transaction:', rollbackError);
        }

        res.status(error.message === 'Station closure not found' ? 404 : 500).json({
            status: 'ERROR',
            message: error.message || 'Failed to update station closure'
        });
    }
});

// Add API endpoint for creating new station closure
app.post('/api/station-closure', async (req, res) => {
    console.log('Received station closure request:', req.body);
    const { station, grandTotal, roomCharges, complementary, cardAmount, cashAmount } = req.body;
    const username = req.headers['x-user'] || 'system';

    // Validate input data
    if (!station) {
        console.error('Station validation failed');
        return res.status(400).json({
            status: 'ERROR',
            message: 'Station must be selected'
        });
    }

    // Validate numeric values
    if (isNaN(grandTotal) || isNaN(cashAmount) || isNaN(cardAmount)) {
        console.error('Invalid amounts:', { grandTotal, cashAmount, cardAmount });
        return res.status(400).json({
            status: 'ERROR',
            message: 'Invalid amount values'
        });
    }

    // Format station name for display (convert pool_bar to Pool Bar)
    const stationDisplay = station.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    // Create a promise-based version of db.run
    const dbRun = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    try {
        console.log('Starting transaction for station closure');
        await dbRun('BEGIN TRANSACTION');

        // Insert into station_closures table
        const closureResult = await dbRun(
            `INSERT INTO station_closures (
                station, grand_total, room_charges, complementary, net_amount, user, fiscal_date
            ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
            [station, grandTotal, roomCharges || 0, complementary || 0, cashAmount + cardAmount, username]
        );

        const closureId = closureResult.lastID;
        console.log('Station closure record created with ID:', closureId);

        // Log the station closure creation
        await logAction(
            username,
            'CREATE',
            'STATION_CLOSURE',
            closureId,
            `Created station closure for ${stationDisplay}`,
            req,
            null,
            {
                station,
                grandTotal,
                roomCharges,
                complementary,
                cardAmount,
                cashAmount,
                timestamp: new Date().toISOString()
            }
        );

        // Only create a transaction for card payments
        if (cardAmount > 0) {
            console.log('Adding card transaction');
            const transactionResult = await dbRun(
                `INSERT INTO transactions (
                    amount, payment_method, payment_type, user, description, fiscal_date
                ) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
                [cardAmount, 'card', stationDisplay, username, `${stationDisplay} closure - card payments (ID: ${closureId})`]
            );

            // Log the card transaction creation
            await logAction(
                username,
                'CREATE',
                'TRANSACTION',
                transactionResult.lastID,
                `Created card transaction for ${stationDisplay} closure`,
                req,
                null,
                {
                    amount: cardAmount,
                    payment_method: 'card',
                    payment_type: stationDisplay,
                    closure_id: closureId,
                    timestamp: new Date().toISOString()
                }
            );
        }

        await dbRun('COMMIT');
        console.log('Station closure processed successfully');

        res.json({
            status: 'SUCCESS',
            message: 'Station closure processed successfully',
            closureId,
            cashAmount,
            cardAmount
        });
    } catch (error) {
        console.error('Error in station closure process:', error);
        try {
            await dbRun('ROLLBACK');
            console.log('Transaction rolled back successfully');

            // Log the error
            await logAction(
                username,
                'ERROR',
                'STATION_CLOSURE',
                null,
                `Failed to create station closure for ${stationDisplay}: ${error.message}`,
                req,
                {
                    station,
                    grandTotal,
                    roomCharges,
                    complementary,
                    cardAmount,
                    cashAmount
                },
                null
            );
        } catch (rollbackError) {
            console.error('Error rolling back transaction:', rollbackError);
        }

        res.status(500).json({
            status: 'ERROR',
            message: 'Failed to save transactions',
            error: error.message
        });
    }
});

// Add route for register closure page
app.get('/register-closure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register-closure.html'));
});

// Get current fiscal period
app.get('/api/fiscal-period/current', (req, res) => {
    db.get(`SELECT * FROM fiscal_periods WHERE status = 'ACTIVE'`, [], (err, row) => {
        if (err) {
            console.error('Error fetching current fiscal period:', err);
            return res.status(500).json({
                status: 'ERROR',
                message: 'Failed to fetch fiscal period'
            });
        }

        res.json({
            status: 'SUCCESS',
            fiscalPeriod: row
        });
    });
});

// Process register closure
app.post('/api/register-closure', async (req, res) => {
    const username = req.headers['x-user'] || 'system';

    // Create a promise-based version of db.run
    const dbRun = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    try {
        // Start transaction
        await dbRun('BEGIN TRANSACTION');

        // Get current fiscal period
        const currentPeriod = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM fiscal_periods WHERE status = 'ACTIVE'`, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!currentPeriod) {
            throw new Error('No active fiscal period found');
        }

        // Close current period
        await dbRun(
            `UPDATE fiscal_periods 
             SET status = 'CLOSED', 
                 closed_at = datetime('now', 'localtime') 
             WHERE id = ?`,
            [currentPeriod.id]
        );

        // Create new period
        await dbRun(
            `INSERT INTO fiscal_periods (
                current_date, 
                closure_number, 
                status
            ) VALUES (
                datetime('now', 'localtime', '+1 day'),
                ?,
                'ACTIVE'
            )`,
            [currentPeriod.closure_number + 1]
        );

        // Commit transaction
        await dbRun('COMMIT');

        res.json({
            status: 'SUCCESS',
            message: 'Register closed successfully',
            previousPeriod: currentPeriod
        });

    } catch (error) {
        console.error('Error processing register closure:', error);
        try {
            await dbRun('ROLLBACK');
        } catch (rollbackError) {
            console.error('Error rolling back transaction:', rollbackError);
        }

        res.status(500).json({
            status: 'ERROR',
            message: error.message || 'Failed to process register closure'
        });
    }
});

// Get fiscal period history
app.get('/api/fiscal-periods', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    
    db.all(
        `SELECT * FROM fiscal_periods 
         ORDER BY id DESC 
         LIMIT ?`,
        [limit],
        (err, rows) => {
            if (err) {
                console.error('Error fetching fiscal periods:', err);
                return res.status(500).json({
                    status: 'ERROR',
                    message: 'Failed to fetch fiscal periods'
                });
            }

            res.json({
                status: 'SUCCESS',
                fiscalPeriods: rows
            });
        }
    );
});

// Get register base amount
app.get('/api/register/base-amount', (req, res) => {
    db.get('SELECT base_amount FROM register_config ORDER BY id DESC LIMIT 1', [], (err, row) => {
        if (err) {
            console.error('Error fetching base amount:', err);
            return res.status(500).json({
                status: 'ERROR',
                message: 'Failed to fetch base amount'
            });
        }

        res.json({
            status: 'SUCCESS',
            baseAmount: row ? row.base_amount : 300.00
        });
    });
});

// Update register base amount
app.put('/api/register/base-amount', (req, res) => {
    const { baseAmount } = req.body;
    const username = req.headers['x-user'] || 'system';

    if (!baseAmount || isNaN(baseAmount) || baseAmount < 0) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Valid base amount is required'
        });
    }

    db.run(
        `INSERT INTO register_config (base_amount, modified_by) VALUES (?, ?)`,
        [baseAmount, username],
        function(err) {
            if (err) {
                console.error('Error updating base amount:', err);
                return res.status(500).json({
                    status: 'ERROR',
                    message: 'Failed to update base amount'
                });
            }

            res.json({
                status: 'SUCCESS',
                message: 'Base amount updated successfully',
                baseAmount: baseAmount
            });
        }
    );
});

// Create a logging function
async function logAction(user, actionType, entityType, entityId, details, req, oldValues = null, newValues = null) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO system_logs (
            user, action_type, entity_type, entity_id, details, ip_address, old_values, new_values
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        const ipAddress = req.ip || req.connection.remoteAddress;
        
        // Convert objects to JSON strings if they exist
        const oldValuesStr = oldValues ? JSON.stringify(oldValues) : null;
        const newValuesStr = newValues ? JSON.stringify(newValues) : null;

        db.run(sql, [
            user,
            actionType,
            entityType,
            entityId,
            details,
            ipAddress,
            oldValuesStr,
            newValuesStr
        ], function(err) {
            if (err) {
                console.error('Error logging action:', err);
                reject(err);
                return;
            }
            resolve(this.lastID);
        });
    });
}

// Add API endpoint to view logs
app.get('/api/logs', async (req, res) => {
    const username = req.headers['x-user'];
    // You might want to restrict this to admin users only
    
    const filters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        actionType: req.query.actionType,
        entityType: req.query.entityType,
        user: req.query.user
    };

    let sql = `SELECT * FROM system_logs WHERE 1=1`;
    const params = [];

    if (filters.startDate) {
        sql += ` AND date(timestamp) >= ?`;
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        sql += ` AND date(timestamp) <= ?`;
        params.push(filters.endDate);
    }
    if (filters.actionType) {
        sql += ` AND action_type = ?`;
        params.push(filters.actionType);
    }
    if (filters.entityType) {
        sql += ` AND entity_type = ?`;
        params.push(filters.entityType);
    }
    if (filters.user) {
        sql += ` AND user = ?`;
        params.push(filters.user);
    }

    sql += ` ORDER BY timestamp DESC LIMIT 1000`;

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Error fetching logs:', err);
            return res.status(500).json({
                status: 'ERROR',
                message: 'Failed to fetch logs'
            });
        }

        res.json({
            status: 'SUCCESS',
            logs: rows
        });
    });
});

// Add API endpoint to get register configuration
app.get('/api/register/config', (req, res) => {
    res.json({
        status: 'SUCCESS',
        config: {
            baseAmount: config.register.baseAmount
        }
    });
});

// Gracefully close the database connection
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

app.listen(port, () => {
    console.log(`Cash register app running at http://localhost:${port}`);
}); 