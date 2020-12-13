const fs = require('fs');
const Bot = require('./bot');

class BotManager {
    constructor(cc) {
        var self = this;
        try {
            fs.mkdirSync('logs');
        } catch (e) { }
        this.bots = [];
        this.cc = cc;
        this.quota = 0;
        this.lastQuery = {};
        this.updateTimeout = setTimeout(this.update.bind(this), 1000);
    }
    update() {
        var self = this;
        Bot.currentlyStartingGames = 0;
        for (var b of self.bots) {
            if (b.status == Bot.states.STARTING || b.status == Bot.states.WAITING)
                Bot.currentlyStartingGames++;
            b.update();
        }
        self.cc.command('query', {}, function (data) {
            self.updateTimeout = setTimeout(self.update.bind(self), 1000);
            self.lastQuery = data;
            for (var q in data.result) {
                for (var b of self.bots) {
                    if (b.startTime && b.startTime == data.result[q].starttime) {
                        b.emit('ipc-data', {
                            id: q,
                            data: data.result[q]
                        })
                    }
                }
            }
        });
    }
    enforceQuota() {
        var quota = this.quota;
        while (this.bots.length < quota) {
            this.bots.push(new Bot.bot("b" + this.bots.length));
        }
        while (this.bots.length > quota) {
            var b = this.bots.pop();
            b.stop();
        }
    }
    bot(name) {
        for (var bot of this.bots) {
            if (bot.name == name) return bot;
        }
        return null;
    }
    setQuota(quota) {
        quota = parseInt(quota);
        if (!isFinite(quota) || isNaN(quota)) {
            return;
        }
        this.quota = quota;
        this.enforceQuota();
    }
    getJSONStatus() {
        var result = {};
        return result;
    }
}

module.exports = BotManager;