const BotManager = require('./botmanager');
const config = require('./config');

var manager = null;

class app {
	constructor(app, cc) {
		if (process.getuid() != 0) {
			console.log('[FATAL] Bot manager needs superuser privileges, please restart as root');
			process.exit(1);
		}
		if (manager) {
			console.log('[FATAL] Initialized function for bot manager called twice');
			process.exit(1);
		} else {
			manager = new BotManager(cc);
		}

		this.manager = manager;

		app.post('/api/config/:option/:value', (req, res) => {
			if (!config.hasOwnProperty(req.params.option))
				res.status(404).end();
			else {
				console.log(`Switching ${req.params.option} to ${req.params.value}`)
				config[req.params.option] = req.params.value;
				res.status(200).end('' + config[req.params.option]);
			}
		});
		app.get('/api/config/:option', (req, res) => {
			if (!config.hasOwnProperty(req.params.option))
				res.status(404).end();
			else
				res.status(200).end('' + config[req.params.option]);
		});

		app.get('/api/list', function (req, res) {
			var result = {};
			result.quota = manager.quota;
			result.count = manager.bots.length;
			result.bots = {};
			for (var i of manager.bots) {
				result.bots[i.name] = {
					user: i.user
				};
			}
			res.send(result);
		});

		app.get('/api/state', function (req, res) {
			var result = { bots: {} };
			for (var i of manager.bots) {
				result.bots[i.name] = {
					ipc: i.ipcState,
					restarts: i.restarts,
					ipcID: i.ipcID,
					state: i.state,
					started: i.gameStarted,
					pid: i.game
				};
			}
			res.send(result);
		});

		app.get('/api/bot/:bot/restart', function (req, res) {
			if (req.params.bot === "all") {
				for (var bot of manager.bots)
					bot.restart();
				res.status(200).end();
				return;
			}
			var bot = manager.bot(req.params.bot);
			if (bot) {
				bot.restart();
				res.status(200).end();
			} else {
				res.status(400).send({
					'error': 'Bot does not exist'
				})
			}
		});

		app.get('/api/bot/:bot/terminate', function (req, res) {
			if (req.params.bot === "all") {
				for (var bot of manager.bots)
					bot.stop();
				res.status(200).end();
				return;
			}
			var bot = manager.bot(req.params.bot);
			if (bot) {
				bot.stop();
				res.status(200).end();
			} else {
				res.status(400).send({
					'error': 'Bot does not exist'
				})
			}
		});

		app.get('/api/quota/:quota', function (req, res) {
			manager.setQuota(req.params.quota);
			res.send({
				quota: manager.quota
			});
		});
	}

	stop()
	{
		this.manager.stop();
	}
}

exports.Forever = app;