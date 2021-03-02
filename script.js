const $ = require('jquery');
const format = require('format-duration');
const request = require('browser-request');

const STATE = [ 
	'INITIALIZING',
	'INITIALIZED',
	'PREPARING',
	'STARTING',
	'WAITING',
	'RUNNING',
	'RESTARTING',
	'STOPPING',
	'NO ACCOUNT'
];

const classes = [
	"Unknown", "Scout",
	"Sniper", "Soldier",
	"Demoman", "Medic",
	"Heavy", "Pyro",
	"Spy", "Engineer"
];

const teams = [
    "UNK", "SPEC", "RED", "BLU"
]

const status = {
    info: function(text) {
        console.log('[INFO]', text);
        $('#status-text').attr('class', '').text(text);
    },
    warning: function(text) {
        console.log('[WARNING]', text);
        $('#status-text').attr('class', 'warning').text(text);
    },
    error: function(text) {
        console.log('[ERROR]', text);
        $('#status-text').attr('class', 'error').text(text);
    }
}

var last_count = 0;

function updateData() {
	request('api/state', function(error, r, b) {
		if (error) return;
		var data = JSON.parse(b);
		if (last_count != Object.keys(data.bots).length) {
			refreshComplete();
		}
		for (var i in data.bots) {
			updateUserData(i, data.bots[i]);
		}
	});
}

function commandButtonCallback() {
    var cmdz = prompt('Enter a command');
    if (cmdz) {
		cmd('exec', {
			target: parseInt($(this).parent().parent().find('.client-id').text()),
			cmd: cmdz
		}, null)
    }
}

function restartButtonCallback() {
	console.log('restarting',$(this).parent().parent().attr('data-id'));
    request(`api/bot/${$(this).parent().parent().attr('data-id')}/restart`, function(e, r, b) {
		if (e) {
			console.log(e,b);
			status.error('Error restarting bot');
		} else {
			status.info('Bot restarted');
		}
	});
}

function restartAllButtonCallback() {
	console.log('restarting all bots');
    request(`api/bot/all/restart`, function(e, r, b) {
		if (e) {
			console.log(e,b);
			status.error('Error restarting bots');
		} else {
			status.info('Bots restarted');
		}
	});
}

function terminateButtonCallback() {
	console.log('terminating',$(this).parent().parent().attr('data-id'));
    request(`api/bot/${$(this).parent().parent().attr('data-id')}/terminate`, function(e, r, b) {
		if (e) {
			console.log(e,b);
			status.error('Error terminating bot');
		} else {
			status.info('Bot terminated');
		}
	});
}

function terminateAllButtonCallback() {
	console.log('restarting all bots');
    request(`api/bot/all/terminate`, function(e, r, b) {
		if (e) {
			console.log(e,b);
			status.error('Error terminating bots');
		} else {
			status.info('Bots terminated');
		}
	});
}

function cmd(command, data, callback) {
	request.post({
		url: 'api/direct/' + command,
		body: JSON.stringify(data),
		headers: {
			"Content-Type": "application/json"
		}
	}, function(e, r, b) {
		if (e) {
			console.log(e);
			status.error('Error making request!');
			if (callback)
				callback(e);
			return;
		}
		try {
			if (callback)
				callback(null, JSON.parse(b));
		} catch (e) {
			console.log(e);
			status.error('Error parsing data from server!');
			if (callback)
				callback(e);
		}
	});
}

var autorestart = {};

function updateIPCData(row, id, data) {
	if (!data) {
		return;
	}
	var time = Math.floor(Date.now() / 1000 - data.heartbeat);
	if (!data.heartbeat || time < 4) {
		row.find('.client-status').removeClass('error warning').text('OK ' + time);
	} else if (time < 45) {
		row.find('.client-status').removeClass('error').addClass('warning').text('Warning ' + time);
	} else {
		if ($('#autorestart-bots').prop('checked')) {
			if ((Date.now() - data.ts_injected * 1000 > 20) && data.heartbeat && !autorestart[row.attr('data-id')] || (Date.now() - autorestart[row.attr('data-id')]) > 1000 * 5) {
				autorestart[row.attr('data-id')] = Date.now();
				console.log('auto-restarting' ,row.attr('data-id'));
			    request(`api/bot/${row.attr('data-id')}/restart`, function(e, r, b) {
					if (e) {
						console.log(e,b);
						status.error('Error restarting bot ' + JSON.stringify(data));
					} else {
						status.info('Bot restarted ' + JSON.stringify(data));
					}
				});
			}
		}
		row.find('.client-status').removeClass('warning').addClass('error').text('Likely dead ' + time);
	}
	//row.find('.client-uptime').text(format(time - data.starttime));
	row.find('.client-pid').text(data.pid);
	row.find('.client-id').text(id);
	row.find('.client-name').text(data.name);
	row.find('.client-total').text(data.accumulated.score);
	var hitrate = Math.floor((data.accumulated.shots ? data.accumulated.hits / data.accumulated.shots : 0) * 100);
	var hsrate = Math.floor((data.accumulated.hits ? data.accumulated.headshots / data.accumulated.hits : 0) * 100);
	row.find('.client-shots').text(data.accumulated.shots);
	row.find('.client-hitrate').text(hitrate + '%');
	row.find('.client-hsrate').text(hsrate + '%');
	if (data.connected) {
		row.toggleClass('disconnected', false);
		row.find('.client-uptime-server').text(format(Date.now() - data.ts_connected * 1000));
		if (data.ts_disconnected) {
			row.find('.client-uptime-queue').text(format(1000 * (data.ts_connected - data.ts_disconnected)));
		}
		row.find('.client-ip').text(data.ingame.server);
		row.find('.client-alive').text(data.ingame.life_state ? 'Dead' : 'Alive');
		row.find('.client-team').text(teams[data.ingame.team]);
		row.find('.client-class').text(classes[data.ingame.role]);
		row.find('.client-score').text(data.ingame.score);
		row.find('.client-health').text(data.ingame.health + '/' + data.ingame.health_max);
        row.find('.client-map').text(data.ingame.mapname);
        row.find('.client-players').text(data.ingame.player_count);
        row.find('.client-bots').text(data.ingame.bot_count);
	} else {
		if (data.ts_disconnected) {
			row.find('.client-uptime-queue').text(format(Date.now() - data.ts_disconnected * 1000));
		} else {
			row.find('.client-uptime-queue').text(format(Date.now() - data.ts_injected * 1000));
		}
		row.toggleClass('disconnected', true);
		row.find('.connected').text('N/A');
	}
}

function updateUserData(bot, data) {
	var row = $(`tr[data-id="${bot}"]`);
	if (!row.length) return;
	row.toggleClass('stopped', data.state != 5);
	row.find('.client-state').text(STATE[data.state]);
	if (data.state == 5 && data.ipc) {
		row.attr('data-pid', data.ipc.pid);
		row.find('.client-pid').text(data.ipc.pid);
		row.find('.client-uptime-total').text(format(Date.now() - data.started));
        row.find('.client-restarts').text(data.restarts);
        row.find('.client-steam').empty().append($('<a></a>').text('Profile').attr('href', `https://steamcommunity.com/profiles/[U:1:${data.ipc.friendid}]`).attr('target', '_blank'));
	}
	if (data.state != 5) {
		row.find('.active').text('N/A');
	}
	updateIPCData(row, data.ipcID, data.ipc);
}

function addClientRow(botid) {
    var row = $('<tr></tr>').attr('data-id', botid).addClass('disconnected stopped');
    var actions = $('<td></td>').attr('class', 'client-actions');
    actions.append($('<input>').attr('type', 'button').attr('value', 'Command').on('click', commandButtonCallback));
    actions.append($('<input>').attr('type', 'button').attr('value', 'Restart').on('click', restartButtonCallback));
    actions.append($('<input>').attr('type', 'button').attr('value', 'Terminate').on('click', terminateButtonCallback));
    row.append(actions);
	row.append($('<td></td>').attr('class', 'client-restarts').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-bot-name').text(botid));
	row.append($('<td></td>').attr('class', 'client-state').text('UNDEFINED'));
	row.append($('<td></td>').attr('class', 'client-steam').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-uptime-total active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-pid active').text('N/A'));
	row.append($('<td></td>').attr('class', 'client-id active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-status active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-name active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-uptime-queue active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-total active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-score connected active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-shots active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-hitrate active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-hsrate active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-uptime-server connected active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-alive connected active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-team connected active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-class connected active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-health connected active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-ip connected active').text('N/A'));
    row.append($('<td></td>').attr('class', 'client-map connected active').text('NYI'));
    row.append($('<td></td>').attr('class', 'client-players connected active').text('NYI'));
    row.append($('<td></td>').attr('class', 'client-bots connected active').text('NYI'));
    $('#clients').append(row);
    return row;
}

function runCommand() {
	cmd('exec_all', { cmd: $('#console').val() });
	$('#console').val('');
}

function refreshComplete() {
	$("#clients tr").slice(1).remove();
	request.get({
		url: 'api/list'
	}, function(e, r, b) {
		if (e) {
			console.log(e, b);
			status.error('Error refreshing the list!');
			return;
		}
		var count = 0;
		var b = JSON.parse(b);
		console.log(b);
		for (var i in b.bots) {
			count++;
			addClientRow(i)
		}
		last_count = count;
	})
}

$(function() {
	updateData();
    status.info('init done');
	setInterval(updateData, 1000 * 2);
	$('#console').on('keypress', function(e) {
		if (e.keyCode == '13') {
			runCommand();
			e.preventDefault();
		}
	});
	$('#bot-quota-apply').on('click', function() {
		request.get('api/quota/' + $('#bot-quota').val(), function(e, r, b) {
			if (e) {
				console.log(e, b);
				status.error('Error applying bot quota!');
			} else {
				status.info('Applied bot quota successfully');
			}
		});
	});
    $('#api-login-button').on('click', () => {
        let password = $('#api-password').val();
        request.post({
            uri: "api/auth",
            form: {
                password: password
            }
        }, (e, r, b) => {
            console.log(b);
        });
    });
	$('#bot-refresh').on('click', refreshComplete);
	$('#console-send').on('click', runCommand);
	$("#bot-restartall").on('click', restartAllButtonCallback);
	$("#bot-terminateall").on('click', terminateAllButtonCallback);
});
