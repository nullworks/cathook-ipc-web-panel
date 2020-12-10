const EventEmitter = require('events');
const child_process = require('child_process');

const sudo = require('sudo');
const timestamp = require('time-stamp');
const _ = require('underscore');
const fs = require('fs');
const procfs = require('procfs-stats');

const procevt = require('./procevt');
const accounts = require('./acc.js');
const ExecQueue = require('./execqueue');
const config = require('./config');

const LAUNCH_OPTIONS_GAME = 'firejail --join=%JAILNAME% su - %USER% -c \'cd $GAMEPATH && LD_LIBRARY_PATH=%LD_LIBRARY_PATH% LD_PRELOAD=%LD_PRELOAD% PULSE_SERVER="unix:/tmp/pulse.sock" DISPLAY=%DISPLAY% ./hl2_linux -game tf -silent -sw -h 640 -w 480 -novid -nojoy -noshaderapi -nomouse -nomessagebox -nominidumps -nohltv -nobreakpad -particles 512 -snoforceformat -softparticlesdefaultoff -threads 1\'';
const LAUNCH_OPTIONS_STEAM = 'firejail --noprofile --blacklist=%STEAMWEBHELPERPATH% --name=%JAILNAME% --dns=1.1.1.1 --netns=%NETNS% --allusers su - %USER% -c \'DISPLAY=%DISPLAY% LD_PRELOAD=%LD_PRELOAD% PULSE_SERVER="unix:/tmp/pulse.sock" steam -silent -login %LOGIN% %PASSWORD% -noverifyfiles -nominidumps -nobreakpad -nobrowser -nofriendsui\'';

// Adjust these values as needed to optimize catbot performance
// How long to wait for the TF2 process to be created by Steam
const TIMEOUT_START_GAME = 10000;
// How long to delay starting TF2 after starting Steam
const GAME_START_DELAY = 60000;
// account-generator artifact, feel free to reduce to e.g. 5000 if using static accounts
const TIMEOUT_RETRY_ACCOUNT = 30000;
// Timeout for cathook to connect to the IPC server once injected
const TIMEOUT_IPC_STATE = 90000;
// How long to wait before starting Steam and TF2 again after they've been terminated due to e.g. IPC timeout
const RESTART_DELAY = 10000;

// Time to wait between starting each instance of Steam or TF2
const steamStartQueue = new ExecQueue(5000);
const gameStartQueue = new ExecQueue(5000);

const STATE = {
    INITIALIZING: 0,
    INITIALIZED: 1,
    STARTING: 3,
    WAITING: 4,
    RUNNING: 5,
    RESTARTING: 6,
    STOPPING: 7,
    WAITING_ACCOUNT: 8,
    INJECTED: 9
}

function makeid(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}


class Bot extends EventEmitter {
    constructor(name, user) {
        super();
        var self = this;
        this.state = STATE.INITIALIZING;

        this.name = name;
        this.user = user;
        this.stopped = false;
        this.account = null;
        this.restarts = 0;

        this.log(`Initializing, user = ${user.name} (${user.uid})`);

        this.procFirejailSteam = null;
        this.procFirejailGame = null;
        this.procGame = null;

        this.procInject = null;

        // Start timestamp
        this.startTime = null;

        // We have to wait some time before we throw it into the queue
        this.processingStartTime = null;
        // Max time we have hit
        this.processingWaitTime = null;

        this.ipcState = null;
        this.ipcID = -1;

        this.gameStarted = 0;

        this.timeoutGameStart = 0;
        this.timeoutIPCState = 0;
        this.timeoutSteamRestart = 0;

        this.logSteam = null;
        this.logGame = null;

        this.isGarbageDistro = !fs.existsSync(`${this.user.home}/.local/share/Steam/steam`);
        this.steamPath = this.isGarbageDistro ? `${this.user.home}/.steam` : `${this.user.home}/.local/share/Steam`
        this.tf2Path = this.isGarbageDistro ? `${this.steamPath}/steam/steamapps/common/Team Fortress 2` : `${this.steamPath}/steamapps/common/Team Fortress 2`

        this.steamNativeRuntime = fs.existsSync("/usr/lib/steam/native_runtime.txt") || !fs.existsSync(`${this.steamPath}/ubuntu12_32/steam-runtime`)

        // Dynamically determine LD_LIBRARY_PATH with steam-runtime
        this.LD_LIBRARY_PATH = `${this.steamNativeRuntime ? "" : child_process.execSync("./run.sh printenv LD_LIBRARY_PATH", {
            cwd: `${this.steamPath}/ubuntu12_32/steam-runtime`
        }).toString().replace(/(\r\n|\n|\r)/gm, "")}:"${this.tf2Path}/bin"`

        // :/lib/i386-linux-gnu:/usr/lib/i386-linux-gnu:/usr/lib/i386-linux-gnu/mesa-egl:/usr/lib/i386-linux-gnu/mesa:/usr/local/lib:/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu/mesa-egl:/usr/lib/x86_64-linux-gnu/mesa:/lib32:/usr/lib32:/libx32:/usr/libx32:/lib:/usr/lib:/usr/lib/i386-linux-gnu/sse2:/usr/lib/i386-linux-gnu/tls:/usr/lib/x86_64-linux-gnu/tls
        this.spawnSteamOptions = {
            shell: 'bash'
        }

        this.spawnGameOptions = {
            shell: 'bash'
        }
        this.on('ipc-data', function (obj) {
            if (self.state != STATE.RUNNING && self.state != STATE.WAITING)
                return;
            var id = obj.id;
            var data = obj.data;
            self.ipcID = id;
            if (!self.ipcState) {
                self.log(`Assigned IPC ID ${id}`);
                var files = fs.readdirSync('/tmp/');
                files.forEach((str, index, arr) => {
                    if (str.startsWith("source_engine") && str.endsWith(".lock"))
                        fs.unlink(`/tmp/${str}`, (err) => {
                            if (err)
                                self.log("[ERROR] Failed to delete a source engine lock!");
                        });
                });
            }
            self.ipcState = data;
            self.state = STATE.RUNNING;
        });

        this.kill();
        self.state = STATE.INITIALIZED;
    }
    startSteamAndGame() {
        var self = this;
        steamStartQueue.push(function () {
            if (self.state != STATE.RESTARTING)
                return;
            self.spawnSteam();
            self.state = STATE.STARTING;

            self.processingStartTime = Date.now();
            self.processingWaitTime = self.processingStartTime;
            var loop = setInterval(function () {
                // Start timestmap + Additional Time (Based on Queue size) 
                if (self.processingStartTime == self.processingWaitTime)
                    self.processingWaitTime = self.processingStartTime + GAME_START_DELAY * (module.exports.currentlyStartingGames + 1);
                if (Date.now() >= self.processingWaitTime)
                {
                    if (self.state == STATE.STARTING)
                        gameStartQueue.push(self.spawnGame.bind(self));
                    // Exit Interval loop
                    clearInterval(loop);
                }
            // Small delay needed because people can click "restart" pretty fast
            }, 500);
        });
    }
    spawnSteam() {
        var self = this;
        this.restarts++;
        if (self.procFirejailSteam) {
            self.log('[ERROR] Steam is already running!');
            return;
        }

        var id = self.user.name.split("-")[1];

        self.procFirejailSteam = child_process.spawn(LAUNCH_OPTIONS_STEAM
            // Username
            .replace("%LOGIN%", self.account.login)
            // Password
            .replace("%PASSWORD%", self.account.password)
            // Name of the firejail jail
            .replace("%JAILNAME%", self.user.name)
            // Linux username
            .replace("%USER%", self.user.name)
            // Path of the steam web helper script. Used to reduce ram usage
            .replace("%STEAMWEBHELPERPATH%", `${self.steamPath}/ubuntu12_64/steamwebhelper.sh`)
            // LD_PRELOAD, "just disable vac"
            .replace("%LD_PRELOAD%", `"${process.env.STEAM_LD_PRELOAD}"`)
            // Linux network namespace
            .replace("%NETNS%", `ns${id}`)
            // XOrg Display
            .replace("%DISPLAY%", process.env.DISPLAY),
            self.spawnSteamOptions);
        self.logSteam = fs.createWriteStream('./logs/' + self.name + '.steam.log');
        self.logSteam.on('error', (err) => { self.log(`error on logSteam pipe: ${err}`) });
        self.procFirejailSteam.stdout.pipe(self.logSteam);
        self.procFirejailSteam.stderr.pipe(self.logSteam);
        self.procFirejailSteam.on('exit', self.handleSteamExit.bind(self));
        self.log(`Launched Steam (${self.procFirejailSteam.pid}) as ${self.account.steamID || self.account.steamid}`);
        self.emit('start-steam', self.procFirejailSteam.pid);
    }
    killSteam() {
        this.log('Killing steam');
        // Firejail will handle smooth termination
        if (this.procFirejailSteam)
            this.procFirejailSteam.kill("SIGINT");
    }
    spawnGame() {
        var self = this;
        if (self.procFirejailGame) {
            self.log('[ERROR] Game is already running!');
            self.stopped = false;
            return;
        }

        var files = fs.readdirSync('/tmp/');
        files.forEach((str, index, arr) => {
        if (str.startsWith("source_engine") && str.endsWith(".lock"))
            fs.unlink(`/tmp/${str}`, (err) => {
                if (err)
                    self.log("[ERROR] Failed to delete a source engine lock!");
            });
        });
        
        var filename = `.gl${makeid(6)}`;
        fs.copyFileSync("/opt/cathook/bin/libcathook-textmode.so", `/tmp/${filename}`);

        self.procFirejailGame = child_process.spawn(LAUNCH_OPTIONS_GAME.replace("$GAMEPATH", self.tf2Path.replace(/(\s+)/g, '\\$1'))
            // Firejail jail name used by this users steam
            .replace("%JAILNAME%", self.user.name)
            // Cathook
            .replace("%LD_PRELOAD%", `"/tmp/${filename}:${process.env.STEAM_LD_PRELOAD}"`)
            // Linux user
            .replace("%USER%", self.user.name)
            // tf2 bin dir, steam runtime
            .replace("%LD_LIBRARY_PATH%", self.LD_LIBRARY_PATH)
            // XORG display
            .replace("%DISPLAY%", process.env.DISPLAY),
            [], self.spawnGameOptions);
        self.state = STATE.WAITING;
        self.logGame = fs.createWriteStream('./logs/' + self.name + '.game.log');
        self.logGame.on('error', (err) => { self.log(`error on logGame pipe: ${err}`) });
        self.procFirejailGame.stdout.pipe(self.logGame);
        self.procFirejailGame.stderr.pipe(self.logGame);
        self.procFirejailGame.on('exit', self.handleGameExit.bind(self));

        self.timeoutGameStart = setTimeout(function () {
            fs.unlinkSync(`/tmp/${filename}`);
            var res = procevt.find('hl2_linux', self.user.uid);
            if (!res.length || !self.procFirejailGame) {
                self.log('[ERROR] Could not find running game!');
                self.timeoutSteamRestart = setTimeout(self.restart.bind(self), TIMEOUT_RESTART);
                return;
            }
            self.procGame = res[0];
            procfs(self.procGame.pid).stat(function (err, ret) {
                if (err) {
                    self.log("Error while getting stat.");
                } else {
                    self.startTime = ret.starttime;
                }
            })

            self.stopped = false;
            self.gameStarted = Date.now();

            clearTimeout(self.timeoutIPCState);
            clearTimeout(self.timeoutGameStart);

            self.log(`Found game (${self.procFirejailGame.pid})`);
            self.emit('start-game', self.procFirejailGame.pid);

            self.timeoutIPCState = setTimeout(function () {
                if (!self.ipcState) {
                    self.log(`IPC data timed out! Failed to inject?`);
                    self.restart();
                }
            }, TIMEOUT_IPC_STATE);
        }, TIMEOUT_START_GAME);
    }
    handleSteamExit(code, signal) {
        var self = this;
        self.log(`Steam (${self.procFirejailSteam.pid}) exited with code ${code}, signal ${signal}`);
        if (!self.stopped)
            self.timeoutSteamRestart = setTimeout(self.restart.bind(self), TIMEOUT_RESTART);
        self.emit('exit-steam');
        delete self.procFirejailSteam;
    }
    handleGameExit(code, signal) {
        var self = this;
        self.log(`Game (${self.procFirejailGame.pid}) exited with code ${code}, signal ${signal}`);
        self.emit('exit-game');
        self.ipcState = null;
        
        if (self.procFirejailSteam)
            self.killSteam();
        delete self.procGame;
        delete self.procFirejailGame;
    }
    stop() {
        var self = this;
        self.stopped = true;
        self.log('Stopping...');
        clearTimeout(self.timeoutSteamRestart);
        clearTimeout(self.timeoutGameStart);
        clearTimeout(self.timeoutIPCState);
        self.state = STATE.STOPPING;
        self.ipcState = null;
        self.kill();
        self.log('Bot stopped');
        self.emit('stop');
    }
    log(message) {
        console.log(`[${timestamp('HH:mm:ss')}][${this.name}][${this.state}] ${message}`);
    }
    kill(force) {
        var self = this;
        self.log('Killing all steam/game processes...');
        // Steam startup script doesn't really obey signals, but firejail does.
        self.killGame();
        self.killSteam();
    }
    killGame() {
        this.log('Killing game');
        if (this.procFirejailGame)
            this.procFirejailGame.kill("SIGINT");
    }
    restart() {
        var self = this;
        if (self.state == STATE.INITIALIZING)
            return;
        self.stop();
        self.timeoutGameStart = setTimeout(() => {
            self.log('Preparing to restart with new account...');
            if (self.state == STATE.RESTARTING) {
                self.log('Duplicate restart?');
            }
            if (self.account && !config.nodiscard) {
                self.log(`Discarding account ${self.account.login} (${self.account.steamID || self.account.steamid})`);
            }
            self.kill();
            clearTimeout(self.timeoutSteamRestart);
            clearTimeout(self.timeoutGameStart);
            clearTimeout(self.timeoutIPCState);
            self.state = STATE.RESTARTING;
            if (config.nodiscard && self.account) {
                self.startSteamAndGame();
            } else {
                accounts.get(function (err, acc) {
                    if (err) {
                        self.state = STATE.WAITING_ACCOUNT;
                        setTimeout(self.restart.bind(self), TIMEOUT_RETRY_ACCOUNT);
                        self.log('Error while getting account!');
                        return;
                    }
                    self.account = acc;
                    self.startSteamAndGame();
                });
            }
        }, 1000);
    }
}

module.exports.bot = Bot;
module.exports.currentlyStartingGames = 0;
module.exports.states = STATE;
