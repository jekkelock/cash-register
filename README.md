# Cash Register Management System

A modern web-based cash register management system designed for retail and service businesses. This application helps manage daily cash transactions, card payments, invoices, and register closures with a user-friendly interface.

## Features

- **Multiple Payment Methods**
  - Cash payments
  - Card payments (with last 4 digits tracking)
  - Invoice generation
  - Debt tracking

- **Register Management**
  - Real-time cash drawer tracking
  - Denomination-wise money counting
  - Base amount maintenance
  - Safe transfer calculations

- **Financial Operations**
  - Daily register closures
  - Station closures
  - Bulk transaction processing
  - Transaction history viewing

- **Security**
  - User authentication
  - Session management
  - Audit logging
  - Fiscal period tracking

## Technical Stack

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js
- **Database**: SQLite
- **UI Framework**: Custom CSS with Flexbox/Grid
- **Icons**: Font Awesome 5

## Installation

1. Clone the repository:
   ```bash
   git clone [repository-url]
   cd cash-register
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Initialize the database:
   ```bash
   node init-db.js
   ```

4. Start the server:
   ```bash
   node index.js
   ```

5. Access the application:
   ```
   http://localhost:3000
   ```

## Configuration

The application can be configured through the `config.js` file:

- Database settings
- Server port
- Register base amount
- Default drawer contents

## API Endpoints

### Register Operations
- `GET /api/drawer` - Get current drawer contents
- `PUT /api/drawer` - Update drawer contents
- `GET /api/register/base-amount` - Get register base amount
- `PUT /api/register/base-amount` - Update register base amount

### Transactions
- `POST /api/transaction` - Process a single transaction
- `GET /api/transactions` - Get transaction history
- `POST /api/bulk-transactions` - Process multiple transactions
- `PUT /api/transactions/:id` - Update a transaction

### Financial Management
- `POST /api/register-closure` - Process daily register closure
- `GET /api/fiscal-period/current` - Get current fiscal period
- `GET /api/invoices` - Get invoice history

## Usage

1. **Login**: Access the system using your credentials
2. **Main Menu**: Choose from various operations:
   - Process payments
   - View transactions
   - Manage register
   - Handle closures
3. **Register Closure**: End-of-day process
   - Counts total cash
   - Calculates safe transfer amount
   - Maintains base amount
   - Creates new fiscal period

## Database Schema

The system uses SQLite with the following main tables:
- `transactions` - Payment records
- `fiscal_periods` - Accounting periods
- `register_config` - Register settings
- `invoices` - Invoice records
- `audit_log` - System activity tracking

## Security Considerations

- All API endpoints require authentication
- Sensitive operations are logged
- User sessions are managed via localStorage
- API requests include user identification headers

## Error Handling

The system includes comprehensive error handling:
- API response status checking
- User-friendly error messages
- Console logging for debugging
- Graceful fallbacks for network issues

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License

Copyright (c) 2024 [Your Name or Organization]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Support

For support, please [contact details or link to issues] 