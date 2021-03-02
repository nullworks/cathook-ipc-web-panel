const fs = require('fs');
const timestamp = require('time-stamp');

module.exports = {
    get: function get(index) {
        try {
            var accounts = fs.readFileSync("../accounts.txt", 'utf8');
            accounts = accounts.trim();
            let data_array = accounts.split(/\r\n|\r|\n|:/g);
            let account_array = [];
            for (let i = 0; i < data_array.length / 2; i++)
                account_array.push({ login: data_array[i * 2], password: data_array[i * 2 + 1] });
            if (index >= account_array.length)
            {
                console.log(`[${timestamp('HH:mm:ss')}][Account Database] Index ${index} not in account file (too few accounts)`);
                return null;
            }
            return account_array[index];
        }
        catch (error) {
            console.error(error);
            console.error("Error Reading 'accounts.txt' in catbot-setup. Exiting.");
            process.exit(1);
        }
    }
}
