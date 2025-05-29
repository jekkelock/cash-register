const sqlite3 = require('sqlite3').verbose();
const config = require('./config');

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

    // Create safe_transfers table
    db.run(`CREATE TABLE IF NOT EXISTS safe_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount DECIMAL(10,2) NOT NULL,
        transfer_date DATETIME DEFAULT (datetime('now', 'localtime')),
        status TEXT DEFAULT 'PENDING',
        user TEXT NOT NULL,
        notes TEXT,
        fiscal_date DATETIME DEFAULT (datetime('now', 'localtime'))
    )`, (err) => {
        if (err) {
            console.error('Error creating safe_transfers table:', err);
            return;
        }
        console.log('Safe transfers table ready');

        // Initialize with starting balance if empty
        db.get('SELECT COUNT(*) as count FROM safe_transfers', [], (err, row) => {
            if (err) {
                console.error('Error checking safe transfers:', err);
                return;
            }
            if (row.count === 0) {
                // Add initial safe balance
                db.run(
                    `INSERT INTO safe_transfers (amount, status, user, notes) VALUES (?, ?, ?, ?)`,
                    [0, 'SUCCESS', 'system', 'Initial safe balance'],
                    (err) => {
                        if (err) {
                            console.error('Error initializing safe balance:', err);
                            return;
                        }
                        console.log('Safe initialized with 0 balance');
                    }
                );
            }
        });
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
                    [800.00, 'system'],
                    (err) => {
                        if (err) {
                            console.error('Error initializing register config:', err);
                            return;
                        }
                        console.log('Register config initialized with base amount');
                    }
                );
            }
        });
    });

    // Create fiscal_periods table
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
});

// Close database connection when the script finishes
process.on('exit', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
    });
}); 