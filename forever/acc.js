const fs = require('fs');
const timestamp = require('time-stamp');

module.exports = {
    get: function get(index) {
        try {
            var accounts = fs.readFileSync("../accounts.txt", 'utf8');
            accounts = accounts.trim();
            //fixes undefined:undefined login when accounts.txt is empty.
            if (accounts.length === 0) {
            console.error(`[!][${timestamp('HH:mm:ss')}][Account Database][ERR] There was no accounts found.`)
            process.exit(1)
            return;
            //return null;
            }
            let data_array = accounts.split(/\r\n|\r|\n|:/g);
            let account_array = [];
            for (let i = 0; i < data_array.length / 2; i++)
                account_array.push({ login: data_array[i * 2], password: data_array[i * 2 + 1] });
            if (index >= account_array.length)
            {
                console.log(`[!][${timestamp('HH:mm:ss')}][Account Database][ERR] Account for b${index} wasn't found.`);
                console.error(`Account for b${index} wasn't found.`);
                return null;
            }
            return account_array[index];
        }
        catch (error) {
            console.error("Unable to read accounts, exiting...");
            console.error(error);
            process.exit(1);
        }
    }
}
