const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 3000;

// Initialize database
const db = new sqlite3.Database('cash_register.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
        return;
    }
    console.log('Connected to SQLite database');

    // Create transactions table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        amount DECIMAL(10,2) NOT NULL,
        payment_method TEXT NOT NULL,
        payment_type TEXT NOT NULL,
        card_last_digits TEXT,
        user TEXT DEFAULT 'system'
    )`, (err) => {
        if (err) {
            console.error('Error creating transactions table:', err);
            return;
        }
        console.log('Transactions table ready');
    });

    // Create users table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
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
    });

    // Create debts table
    db.run(`CREATE TABLE IF NOT EXISTS debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
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
        this.drawer = {
            CENT1: { value: 0.01, quantity: 100 },
            CENT2: { value: 0.02, quantity: 100 },
            CENT5: { value: 0.05, quantity: 100 },
            CENT10: { value: 0.10, quantity: 100 },
            CENT20: { value: 0.20, quantity: 100 },
            CENT50: { value: 0.50, quantity: 100 },
            EURO1: { value: 1.00, quantity: 100 },
            EURO2: { value: 2.00, quantity: 100 },
            EURO5: { value: 5.00, quantity: 20 },
            EURO10: { value: 10.00, quantity: 10 },
            EURO20: { value: 20.00, quantity: 5 },
            EURO50: { value: 50.00, quantity: 5 },
            EURO100: { value: 100.00, quantity: 2 },
            EURO200: { value: 200.00, quantity: 1 }
        };
    }

    getDrawerTotal() {
        return Object.values(this.drawer).reduce((total, coin) => {
            return total + (coin.value * coin.quantity);
        }, 0).toFixed(2);
    }

    getDrawerContents() {
        return this.drawer;
    }

    makeTransaction(amount, paymentMethod, paymentType, cardLastDigits = null, invoiceDetails = null) {
        return new Promise((resolve, reject) => {
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
                    (amount, date_issued, recipient_name, vat_number, status, user) 
                    VALUES (?, ?, ?, ?, ?, ?)`;
                
                db.run(sql, [
                    amount,
                    invoiceDetails.dateIssued,
                    invoiceDetails.recipientName,
                    invoiceDetails.vatNumber || null,
                    'SUCCESS',
                    'system' // Will be replaced with actual user once login is implemented
                ], function(err) {
                    if (err) {
                        console.error('Error saving invoice:', err);
                        reject({ 
                            status: 'ERROR',
                            message: 'Failed to save invoice'
                        });
                        return;
                    }

                    resolve({ 
                        status: 'SUCCESS',
                        message: `Invoice payment processed successfully: €${amount} to ${invoiceDetails.recipientName}`,
                        transactionId: this.lastID
                    });
                });
                return;
            }

            // Handle cash and card payments
            const sql = `INSERT INTO transactions 
                (amount, payment_method, payment_type, card_last_digits, user) 
                VALUES (?, ?, ?, ?, ?)`;
            
            db.run(sql, [
                amount,
                paymentMethod,
                paymentType,
                cardLastDigits,
                'system' // Will be replaced with actual user once login is implemented
            ], function(err) {
                if (err) {
                    console.error('Error saving transaction:', err);
                    reject({ 
                        status: 'ERROR',
                        message: 'Failed to save transaction'
                    });
                    return;
                }

                resolve({ 
                    status: 'SUCCESS',
                    message: `Transaction processed successfully: €${amount} via ${paymentMethod}`,
                    transactionId: this.lastID
                });
            });
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
app.get('/api/drawer', (req, res) => {
    res.json({
        total: register.getDrawerTotal(),
        contents: register.getDrawerContents()
    });
});

app.post('/api/transaction', async (req, res) => {
    try {
        const { amount, paymentMethod, paymentType, cardLastDigits, invoiceDetails } = req.body;
        const result = await register.makeTransaction(
            amount, 
            paymentMethod, 
            paymentType, 
            cardLastDigits,
            invoiceDetails
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
app.post('/api/debts', (req, res) => {
    const { person_name, amount_taken, description } = req.body;
    
    if (!person_name || !amount_taken || amount_taken <= 0) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Person name and valid amount are required'
        });
    }

    const sql = `INSERT INTO debts (person_name, amount_taken, description, user) VALUES (?, ?, ?, ?)`;
    const username = req.headers['x-user'] || 'system';

    db.run(sql, [person_name, amount_taken, description, username], function(err) {
        if (err) {
            console.error('Error creating debt record:', err);
            return res.status(500).json({
                status: 'ERROR',
                message: 'Failed to create debt record'
            });
        }

        res.json({
            status: 'SUCCESS',
            message: 'Debt record created successfully',
            debtId: this.lastID
        });
    });
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

app.put('/api/debts/:id', (req, res) => {
    const { amount_returned, invoice_amount } = req.body;
    const debtId = req.params.id;

    if (!debtId || (amount_returned === undefined && invoice_amount === undefined)) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Invalid update data'
        });
    }

    // First get the current debt record
    db.get('SELECT * FROM debts WHERE id = ?', [debtId], (err, debt) => {
        if (err || !debt) {
            return res.status(404).json({
                status: 'ERROR',
                message: 'Debt record not found'
            });
        }

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

        const sql = `UPDATE debts 
                    SET amount_returned = ?,
                        invoice_amount = ?,
                        status = ?
                    WHERE id = ?`;

        db.run(sql, [new_amount_returned, new_invoice_amount, status, debtId], function(err) {
            if (err) {
                console.error('Error updating debt record:', err);
                return res.status(500).json({
                    status: 'ERROR',
                    message: 'Failed to update debt record'
                });
            }

            res.json({
                status: 'SUCCESS',
                message: 'Debt record updated successfully'
            });
        });
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