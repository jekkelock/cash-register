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
        status TEXT NOT NULL,
        user TEXT DEFAULT 'system'
    )`, (err) => {
        if (err) {
            console.error('Error creating transactions table:', err);
            return;
        }
        console.log('Transactions table ready');
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
});

app.use(bodyParser.json());
app.use(express.static('public'));

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
                (amount, payment_method, payment_type, card_last_digits, status, user) 
                VALUES (?, ?, ?, ?, ?, ?)`;
            
            db.run(sql, [
                amount,
                paymentMethod,
                paymentType,
                cardLastDigits,
                'SUCCESS',
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

    getTransactions(limit = 50) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?`;
            db.all(sql, [limit], (err, rows) => {
                if (err) {
                    console.error('Error fetching transactions:', err);
                    reject(err);
                    return;
                }
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
        const transactions = await register.getTransactions();
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