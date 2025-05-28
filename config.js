module.exports = {
    // Database configuration
    database: {
        filename: 'cash_register.db'
    },

    // Server configuration
    server: {
        port: 3000
    },

    // Register configuration
    register: {
        baseAmount: 300.00,  // Base amount to keep in register
        drawer: {
            // Default drawer contents when initializing
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
            EURO100: { value: 100.00, quantity: 2 }
        }
    }
}; 