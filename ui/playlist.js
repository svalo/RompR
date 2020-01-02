var playlist = function() {

	var tracklist = [];
	var currentalbum = -1;
	var finaltrack = -1;
	var do_delayed_update = false;
	var pscrolltimer = null;
	var pageloading = true;
	var lookforcurrenttrack = false;
	var update_queue = -1;
	var current_queue_request = 0;
	var playlist_valid = false;

	var update_error = false;
	var retrytimer;
	var popmovetimer = null;
	var popmoveelement = null;
	var popmovetimeout = 2000;

	// Minimal set of information - just what infobar requires to make sure
	// it blanks everything out
	// playlistpos is for radioManager
	// backendid must not be undefined
	var emptyTrack = {
		Album: "",
		trackartist: "",
		file: "",
		Title: "",
		type: "",
		Pos: 0,
		Id: -1,
		progress: 0,
		images: null
	};

	var currentTrack = emptyTrack;

	function addSearchDir(element) {
		var options = new Array();
		element.next().find('.playable').each(function(index, elem){
			if ($(elem).hasClass('searchdir')) {
				options.concat(addSearchDir($(elem)));
			} else {
				options.push({
					type: 'uri',
					name: decodeURIComponent($(elem).attr('name'))
				});
			}
		});
		return options;
	}

	function personalRadioManager() {

		var self = this;
		var mode = '';
		var param = null;
		var radios = new Object();
		var rptimer = null;
		var startplaybackfrom = null;

		function actuallyRepopulate() {
			debug.log("RADIO MANAGER","Repopulate Timer Has Fired");
			debug.log("RADIO MANAGER","mode is",mode);
			debug.trace("RADIO MANAGER","prefs.radiomode is",prefs.radiomode);
			debug.trace("RADIO MANAGER","prefs.radioparam is",prefs.radioparam);
			debug.trace("RADIO MANAGER","prefs.browser_id is",prefs.browser_id);
			debug.trace("RADIO MANAGER","prefs.radiomaster is",prefs.radiomaster);

			if ((mode && mode != prefs.radiomode) || (mode && param && param != prefs.radioparam)) {
				radios[mode].func.stop();
			}

			param = prefs.radioparam;

			if (prefs.radiomode != mode) {
				mode = prefs.radiomode;
				if (mode) {
					playlist.preventControlClicks(false);
					player.controller.takeBackControl();
					if (radios[mode].script && radios[mode].loaded == false) {
						debug.shout("RADIO MANAGER","Loading Script",radios[mode].script,"for",mode);
						$.getScript(radios[mode].script+'?version='+rompr_version)
							.done(function() {
								radios[mode].loaded = true;
								actuallyActuallyRepopulate();
							})
							.fail(function(data,thing,wotsit) {
								debug.error("RADIO MANAGER","Failed to Load Script",wotsit);
								mode = null;
								player.controller.checkConsume(prefs.radioconsume);
								playlist.repopulate();
								infobar.error(language.gettext('label_general_error'));
							});
					} else {
						actuallyActuallyRepopulate();
					}
				} else {
					player.controller.checkConsume(prefs.radioconsume);
					playlist.preventControlClicks(true);
					setHeader();
				}
			} else {
				actuallyActuallyRepopulate();
			}
		}

		function actuallyActuallyRepopulate() {
			setHeader();
			var fromend = playlist.getfinaltrack()+1;
			if (currentTrack.playlistpos) {
				fromend -= currentTrack.playlistpos;
			}
			var tracksneeded = prefs.smartradio_chunksize - fromend;
			if (tracksneeded > 1 && prefs.radiomaster != prefs.browser_id) {
				debug.mark("RADIO MANAGER","Looks like master has gone away. Taking over");
				prefs.save({radiomaster: prefs.browser_id});
			}
			debug.log("RADIO MANAGER","Repopulate Check : Final Track :",playlist.getfinaltrack()+1,"Fromend :",fromend,"Chunksize :",prefs.smartradio_chunksize,"Mode :",mode);
			if (playlist_valid && mode && prefs.radiomaster == prefs.browser_id) {
				// Don't do anything if we're waiting on playlist updates
				if (fromend < prefs.smartradio_chunksize) {
					debug.shout("RADIO MANAGER","Repopulating");
					radios[mode].func.populate(prefs.radioparam, tracksneeded);
				}
			}
		}

		function setHeader() {
			var html = '';
			if (mode && radios[mode].func.modeHtml) {
				var x = radios[mode].func.modeHtml(prefs.radioparam);
				if (x) {
					html = x + '<i class="icon-cancel-circled playlisticon clickicon" style="margin-left:8px" onclick="playlist.radioManager.stop()"></i>';
				}
			}
			layoutProcessor.setRadioModeHeader(html);
		}

		return {

			register: function(name, fn, script) {
				debug.log("RADIO MANAGER","Registering Plugin",name);
				radios[name] = {func: fn, script: script, loaded: false};
			},

			init: function() {
				for(var i in radios) {
					debug.log("RADIO MANAGER","Activating Plugin",i);
					radios[i].func.setup();
				}
				if (prefs.player_backend == "mopidy") {
					$("#radiodomains").addClass('tiny').makeDomainChooser({
						default_domains: prefs.mopidy_radio_domains,
						sources_not_to_choose: {
									bassdrive: 1,
									dirble: 1,
									tunein: 1,
									audioaddict: 1,
									oe1: 1,
									podcast: 1,
							}
					});
					$("#radiodomains").find('input.topcheck').each(function() {
						$(this).on('click', function() {
							prefs.save({mopidy_radio_domains: $("#radiodomains").makeDomainChooser("getSelection")});
						});
					});
				}
				uiHelper.setupPersonalRadio();
			},

			load: function(which, param) {
				if (prefs.debug_enabled > 0) {
					infobar.longnotify(language.gettext('warning_smart_debug'));
				}
				if (!mode) {
					prefs.save({radioconsume: player.status.consume});
				}
				layoutProcessor.playlistLoading();
				prefs.save({radiomode: which, radioparam: param, radiomaster: prefs.browser_id}, player.controller.clearPlaylist);
				startplaybackfrom = 0;
			},

			playbackStartPos: function() {
				// startplaybackfrom is set to 0 when we first start a new radio. This makes the radio populate
				// functions start playback when they first populate. After that it's set to null, because otherwise
				// the user can stop playback, we repopulate, and playback starts again.
				var a = startplaybackfrom;
				startplaybackfrom = null;
				return a;
			},

			repopulate: function() {
				debug.debug("RADIO MANAGER","Setting Repopulate Timer");
				// The timer is a mechanism to stop us repeatedly calling this when
				// lots of asynchronous stuff is happening at once. There are several routes
				// that call into this function to handle all the cases we need to handle
				// but we only want to act on one of them.
				clearTimeout(rptimer);
				rptimer = setTimeout(actuallyRepopulate, 1000);
			},

			stop: function(callback) {
				debug.log("RADIO MANAGER","Stopping");
				// Not stricly ncessary, but does make the UI more responsive
				layoutProcessor.setRadioModeHeader('');
				callback = (callback || playlist.repopulate);
				prefs.save({radiomode: '', radioparam: null}, callback);
			},

			isRunning: function() {
				return (mode != '');
			},

			loadFromUiElement: function(element) {
				var params = element.attr('name').split('+');
				playlist.radioManager.load(params[0], params[1] ? params[1] : null);
			},

			standardBox: function(station, param, icon, label) {
				var container = $('<div>', {
					class: 'menuitem containerbox playable smartradio collectionitem',
					name: station + (param ? '+'+param : '')
				});
				container.append('<div class="svg-square fixed '+icon+'"></div>');
				container.append('<div class="expand">'+label+'</div>');
				return container;
			},

			dropdownHeader: function(station, param, icon, label, dropid) {
				var container = $('<div>', {
					class: 'menuitem containerbox playable smartradio collectionitem',
					name: station + (param ? '+'+param : '')
				});
				container.append($('<i>', {
					class: 'icon-toggle-closed menu openmenu mh fixed',
					name: dropid
				}));
				container.append('<div class="svg-square noindent fixed '+icon+'"></div>');
				container.append('<div class="expand">'+label+'</div>');
				return container;
			},

			dropdownHolder: function(id) {
				return $('<div>', {
					class: 'toggledown invisible expand',
					id: id
				});
			},

			textEntry: function(icon, label, id) {
				var html = '<div class="menuitem containerbox fullwidth">';
				html += '<div class="svg-square fixed '+icon+'"></div>';
				html += '<div class="expand dropdown-holder"><input class="enter clearbox" id="'+id+'" type="text" placeholder="'+label+'" /></div>';
				html += '<button class="fixed alignmid" name="'+id+'">'+language.gettext('button_playradio')+'</button>';
				html += '</div>';
				return html;
			}
		}
	}

	return {

		rolledup: [],

		radioManager: new personalRadioManager(),

		repopulate: async function() {

			var count = -1;
			var current_album = "";
			var current_artist = "";
			var current_type = "";

			update_queue++;
			var my_queue_id = update_queue;
			playlist_valid = false;

			while (my_queue_id > current_queue_request) {
				debug.mark('PLAYLIST', 'Waiting for outstanding requests to finish');
				await new Promise(r => setTimeout(r, 500));
			}
			if (my_queue_id < update_queue) {
				debug.mark('PLAYLIST', 'Aborting request',my_queue_id);
				current_queue_request++;
				return false;
			}

			debug.log('PLAYLIST', 'Starting update request',my_queue_id);
			coverscraper.clearCallbacks();
			try {
				var list = await $.ajax({
					type: "GET",
					url: "getplaylist.php",
					cache: false,
					dataType: "json"
				});
			} catch (err) {
				current_queue_request++;
				debug.error("PLAYLIST","Got notified that an update FAILED");
				if (update_error === false) {
					update_error = infobar.permerror(language.gettext("label_playlisterror"));
				}
				clearTimeout(retrytimer);
				retrytimer = setTimeout(playlist.repopulate, 2000);
				return false;
			}

			if (update_queue != my_queue_id) {
				debug.mark("PLAYLIST","Response",my_queue_id,"from player does not match current request ID",update_queue);
				current_queue_request++;
				return false;
			}

			am_waiting = false;

			if (update_error !== false) {
				infobar.removenotify(update_error);
				update_error = false;
			}

			debug.log("PLAYLIST","Got Playlist from backend for request",my_queue_id);
			finaltrack = -1;
			currentalbum = -1;
			tracklist = [];
			var totaltime = 0;

			for (var i in list) {
				list[i].Time = parseFloat(list[i].Time);
				totaltime += list[i].Time;
				var sortartist = (list[i].albumartist == "") ? list[i].trackartist : list[i].albumartist;
				if ((sortartist.toLowerCase() != current_artist.toLowerCase()) ||
					list[i].Album.toLowerCase() != current_album.toLowerCase() ||
					list[i].type != current_type)
				{
					current_type = list[i].type;
					current_artist = sortartist;
					current_album = list[i].Album;
					count++;
					switch (list[i].type) {
						case "local":
							var hidden;
							switch (list[i].domain) {
								case 'youtube':
								case 'soundcloud':
									// Track Name == Album Name for these, so it's pointless having them open
									if (playlist.rolledup.hasOwnProperty(sortartist+list[i].Album)) {
										hidden = playlist.rolledup[sortartist+list[i].Album];
									} else {
										hidden = true;
									}
									break;
								default:
									hidden = (playlist.rolledup[sortartist+list[i].Album]) ? true : false;
									break;
							}
							tracklist[count] = new Album(sortartist, list[i].Album, count, hidden);
							break;
						case "stream":
							// Streams are hidden by default - hence we use the opposite logic for the flag
							var hidden = (playlist.rolledup["StReAm"+list[i].Album]) ? false : true;
							tracklist[count] = new Stream(count, list[i].Album, hidden);
							break;
						default:
							tracklist[count] = new Album(sortartist, list[i].Album, count, false);
							break;

					}
				}
				tracklist[count].newtrack(list[i]);
				if (list[i].Id == player.status.songid) {
					currentalbum = count;
					currentTrack.Pos = list[i].Pos;
				}
				finaltrack = parseInt(list[i].Pos);
			}

			// After all that, which will have taken a finite time - which could be a long time on
			// a slow device or with a large playlist, let's check that no more updates are pending
			// before we put all this stuff into the window. (More might have come in while we were organising this one)
			// This might all seem like a faff, but you do not want stuff you've just removed
			// suddenly re-appearing in front of your eyes and then vanishing again. It looks crap.
			if (update_queue != my_queue_id) {
				debug.mark("PLAYLIST","Response",my_reqid,"from player does match current request ID after processing",current_reqid);
				current_queue_request++;
				return false;
			}
			playlist_valid = true;

			$("#sortable").empty();
			for (var i in tracklist) {
				tracklist[i].presentYourself();
			}

			if (finaltrack > -1) {
				$("#pltracks").html((finaltrack+1).toString() +' '+language.gettext("label_tracks"));
				$("#pltime").html(language.gettext("label_duration")+' : '+formatTimeString(totaltime));
			} else {
				$("#pltracks").html("");
				$("#pltime").html("");
			}

			// Invisible empty div tacked on the end is where we add our 'Incoming' animation
			$("#sortable").append('<div id="waiter" class="containerbox"></div>');
			layoutProcessor.setPlaylistHeight();
			if (lookforcurrenttrack !== false) {
				playlist.trackHasChanged(lookforcurrenttrack);
				lookforcurrenttrack = false;
			} else {
				playlist.doUpcomingCrap();
			}
			player.controller.postLoadActions();
			uiHelper.postPlaylistLoad();
			current_queue_request++;
			playlist.radioManager.repopulate();
		},

		doUpcomingCrap: function() {
			var upcoming = new Array();
			debug.trace("PLAYLIST","Doing Upcoming Crap",currentalbum);
			if (currentalbum >= 0 && player.status.random == 0) {
				tracklist[currentalbum].getrest(currentTrack.Id, upcoming);
				var i = parseInt(currentalbum)+1;
				while (i < tracklist.length) {
					tracklist[i].getrest(null, upcoming);
					i++;
				}
				debug.trace("PLAYLIST","Upcoming list is",upcoming);
			} else if (tracklist.length > 0) {
				var i = 0;
				while (i < tracklist.length) {
					tracklist[i].getrest(null, upcoming);
					i++;
				}
			}
			layoutProcessor.playlistupdate(upcoming);
		},

		clear: function() {
			debug.log("PLAYLIST","Stopping Radio Manager");
			playlist.radioManager.stop(player.controller.clearPlaylist);
		},

		handleClick: function(event) {
			event.stopImmediatePropagation();
			var clickedElement = $(this);
			if (clickedElement.hasClass("playid")) {
				player.controller.playId(clickedElement.attr("romprid"));
			} else if (clickedElement.hasClass("clickremovetrack")) {
				playlist.delete(clickedElement.attr("romprid"));
			} else if (clickedElement.hasClass("clickremovealbum")) {
				playlist.deleteGroup(clickedElement.attr("name"));
			} else if (clickedElement.hasClass("clickaddwholealbum")) {
				playlist.addAlbumToCollection(clickedElement.attr("name"));
			} else if (clickedElement.hasClass("clickrollup")) {
				playlist.hideItem(clickedElement.attr("romprname"));
			} else if (clickedElement.hasClass("clickaddfave")) {
				playlist.addFavourite(clickedElement.attr("name"));
			} else if (clickedElement.hasClass("playlistup")) {
				playlist.moveTrackUp(clickedElement.findPlParent(), event);
			} else if (clickedElement.hasClass("playlistdown")) {
				playlist.moveTrackDown(clickedElement.findPlParent(), event);
			} else if (clickedElement.hasClass('rearrange_playlist')) {
				clickedElement.findPlParent().addBunnyEars();
			}
		},

		draggedToEmpty: function(event, ui) {
			// This effectively adds all selected items to the end of the play queue irrespective of CD Player Mode
			debug.log("PLAYLIST","Something was dropped on the empty playlist area",event,ui);
			playlist.addItems($('.selected').filter(removeOpenItems), parseInt(finaltrack)+1);
		},

		dragstopped: function(event, ui) {
			debug.trace("PLAYLIST","Drag Stopped",event,ui);
			if (event) {
				event.stopImmediatePropagation();
			}
			var moveto  = (function getMoveTo(i) {
				if (i !== null) {
					debug.trace("PLAYLIST", "Finding Next Item In List",i.next(),i.parent());
					if (i.next().hasClass('track') || i.next().hasClass('booger')) {
						debug.trace("PLAYLIST","Next Item Is Track");
						return parseInt(i.next().attr("name"));
					}
					if (i.next().hasClass('trackgroup') && i.next().is(':hidden')) {
						debug.trace("PLAYLIST","Next Item is hidden trackgroup");
						// Need to account for these - you can't see them so it
						// looks like you're dragging to the next item below it therfore
						// that's how we must behave
						return getMoveTo(i.next());
					}
					if (i.next().hasClass('item') || i.next().hasClass('trackgroup')) {
						debug.trace("PLAYLIST","Next Item Is Item or Trackgroup",
							parseInt(i.next().attr("name")),
							tracklist[parseInt(i.next().attr("name"))].getFirst());
						return tracklist[parseInt(i.next().attr("name"))].getFirst();
					}
					if (i.parent().hasClass('trackgroup')) {
						debug.trace("PLAYLIST","Parent Item is Trackgroup");
						return getMoveTo(i.parent());
					}
					debug.trace("PLAYLIST","Dropped at end?");
				}
				return (parseInt(finaltrack))+1;
			})(ui);

			if (ui.hasClass("draggable")) {
				// Something dragged from the albums list
				debug.log("PLAYLIST","Something was dropped from the albums list");
				doSomethingUseful(ui.attr('id'), language.gettext('label_incoming'));
				playlist.addItems($('.selected').filter(removeOpenItems), moveto);
			} else if (ui.hasClass('track') || ui.hasClass('item')) {
				// Something dragged within the playlist
				var elementmoved = ui.hasClass('track') ? 'track' : 'item';
				switch (elementmoved) {
					case "track":
						var firstitem = parseInt(ui.attr("name"));
						var numitems = 1;
						break;
					case "item":
						var firstitem = tracklist[parseInt(ui.attr("name"))].getFirst();
						var numitems = tracklist[parseInt(ui.attr("name"))].getSize();
						break;
				}
				// If we move DOWN we have to calculate what the position will be AFTER the items have been moved.
				// It's understandable, but slightly counter-intuitive
				if (firstitem < moveto) {
					moveto = moveto - numitems;
					if (moveto < 0) { moveto = 0; }
				}
				player.controller.move(firstitem, numitems, moveto);
			} else {
				return false;
			}
		},

		addItems: function(elements, moveto) {
			// Call into this to add UI elements to the Play Queue
			// CD Player Mode will always be respected
			var tracks = new Array();
			$.each(elements, function (index, element) {
				var uri = $(element).attr("name");
				debug.log("PLAYLIST","Adding",uri);
				if (uri) {
					if ($(element).hasClass('searchdir')) {
						var s = addSearchDir($(element));
						tracks = tracks.concat(s);
					} else if ($(element).hasClass('directory')) {
						tracks.push({
							type: "uri",
							name: decodeURIComponent($(element).children('input').first().attr('value'))
						});
					} else if ($(element).hasClass('clickalbum')) {
						tracks.push({
							type: "item",
							name: uri
						});
					} else if ($(element).hasClass('podcasttrack')) {
						tracks.push({
							type: "podcasttrack",
							name: decodeURIComponent(uri)
						});
					} else if ($(element).hasClass('clickartist')) {
						tracks.push({
							type: "artist",
							name: uri
						});
					} else if ($(element).hasClass('clickcue')) {
						tracks.push({
							type: "cue",
							name: decodeURIComponent(uri)
						});
					} else if ($(element).hasClass('clickstream')) {
						tracks.push({
							type: "stream",
							url: decodeURIComponent(uri),
							image: $(element).attr('streamimg') || null,
							station: $(element).attr('streamname') || null
						});
					} else if ($(element).hasClass('clickloadplaylist')) {
						tracks.push({
							type: "playlist",
							name: decodeURIComponent($(element).children('input[name="dirpath"]').val())
						});
					} else if ($(element).hasClass('clickloaduserplaylist')) {
						tracks.push({
							type: 'remoteplaylist',
							name: decodeURIComponent($(element).children('input[name="dirpath"]').val())
						});
					} else if ($(element).hasClass('playlisttrack')) {
						tracks.push({
							type: 'playlisttrack',
							playlist: decodeURIComponent($(element).children('input.playlistname').val()),
							frompos: decodeURIComponent($(element).children('input.playlistpos').val()),
							name: decodeURIComponent(uri)
						});
					} else if ($(element).hasClass('smartradio')) {
						playlist.radioManager.loadFromUiElement($(element));
					} else if ($(element).hasClass('podcastresume')) {
						tracks.push({
							type: 'resumepodcast',
							resumefrom: $(element).next().val(),
							uri: decodeURIComponent(uri)
						});
					} else {
						tracks.push({ type: "uri",
										name: decodeURIComponent(uri)});
					}
				}
			});
			if (tracks.length > 0) {
				var playpos = (moveto === null) ? playlist.playFromEnd() : null;
				// if moveto is set then these items were dragged in, in which
				// case we must always queue
				var queue = (moveto !== null);
				player.controller.addTracks(tracks, playpos, moveto, queue);
				$('.selected').removeFromSelection();
			}
		},

		setButtons: function() {
			var c = (player.status.xfade === undefined || player.status.xfade === null || player.status.xfade == 0) ? "off" : "on";
			$("#crossfade").flowToggle(c);
			$.each(['random', 'repeat', 'consume'], function(i,v) {
				c = player.status[v] == 0 ? 'off' : 'on';
				$("#"+v).flowToggle(c);
			});
			if (player.status.replay_gain_mode) {
				$.each(["off","track","album","auto"], function(i,v) {
					if (player.status.replay_gain_mode == v) {
						$("#replaygain_"+v).switchToggle("on");
					} else {
						$("#replaygain_"+v).switchToggle("off");
					}
				});
			}
			if (player.status.xfade !== undefined && player.status.xfade !== null &&
				player.status.xfade > 0 && player.status.xfade != prefs.crossfade_duration) {
				prefs.save({crossfade_duration: player.status.xfade});
				debug.log('PLAYLIST', 'Updating Crossfade Duration');
				$("#crossfade_duration").val(player.status.xfade);
			}
		},

		preventControlClicks: function(t) {
			if (t) {
				$('#random').on('click', player.controller.toggleRandom);
				$('#repeat').on('click', player.controller.toggleRepeat);
				$('#consume').on('click', player.controller.toggleConsume);
				$('#crossfade').on('click', player.controller.toggleCrossfade);
				$('#flowcontrols').removeClass('notenabled');
			} else {
				$('#random').off('click').addClass('notenabled');
				$('#repeat').off('click').addClass('notenabled');
				$('#consume').off('click').addClass('notenabled');
				$('#crossfade').off('click').addClass('notenabled');
				$('#flowcontrols').removeClass('notenabled').addClass('notenabled');
			}
		},

		delete: function(id) {
			$('.track[romprid="'+id.toString()+'"]').remove();
			player.controller.removeId([parseInt(id)]);
		},

		waiting: function() {
			$("#waiter").empty();
			doSomethingUseful('waiter', language.gettext("label_incoming"));
		},

		hideItem: function(i) {
			tracklist[i].rollUp();
		},

		playFromEnd: function() {
			if (player.status.state != "play") {
				debug.trace("PLAYLIST","Playfromend",finaltrack+1);
				return finaltrack+1;
			} else {
				debug.trace("PLAYLIST","Disabling auto-play");
				return null;
			}
		},

		getfinaltrack: function() {
			return finaltrack;
		},

		checkPodcastProgress: function() {
			if (player.status.state == 'play' || player.status.state == 'pause') {
				var durationfraction = currentTrack.progress/currentTrack.Time;
				var progresstostore = (durationfraction > 0.05 && durationfraction < 0.98) ? currentTrack.progress : 0;
				if (currentTrack.type == "podcast") {
					podcasts.storePlaybackProgress({uri: currentTrack.file, progress: Math.round(progresstostore)});
				} else if (currentTrack.type == 'audiobook') {
					nowplaying.storePlaybackProgress(Math.round(progresstostore), null);
				}
			}
		},

		trackHasChanged: function(backendid) {
			if (!playlist_valid) {
				debug.log("PLAYLIST","Deferring looking for current track - there is an ongoing update");
				lookforcurrenttrack = backendid;
				return;
			}
			var force = (currentTrack.Id == -1) ? true : false;
			lookforcurrenttrack = false;
			if (backendid != currentTrack.Id) {
				debug.log("PLAYLIST","Looking For Current Track",backendid);
				$("#pscroller .playlistcurrentitem").removeClass('playlistcurrentitem').addClass('playlistitem');
				$('.track[romprid="'+backendid+'"],.booger[romprid="'+backendid+'"]').removeClass('playlistitem').addClass('playlistcurrentitem');
				if (backendid && tracklist.length > 0) {
					for(var i in tracklist) {
						var c = tracklist[i].findcurrent(backendid);
						if (c !== false) {
							currentTrack = c;
							if (currentalbum != i) {
								currentalbum = i;
								$(".playlistcurrenttitle").removeClass('playlistcurrenttitle').addClass('playlisttitle');
								$('.item[name="'+i+'"]').removeClass('playlisttitle').addClass('playlistcurrenttitle');
							}
							break;
						}
					}
				} else {
					currentTrack = emptyTrack;
				}
				playlist.radioManager.repopulate();
				nowplaying.newTrack(playlist.getCurrentTrack(), force);
			}
			playlist.doUpcomingCrap();
			clearTimeout(pscrolltimer);
			if (pageloading) {
				pscrolltimer = setTimeout(playlist.scrollToCurrentTrack, 3000);
			} else {
				playlist.scrollToCurrentTrack();
			}
		},

		scrollToCurrentTrack: function() {
			pageloading = false;
			layoutProcessor.scrollPlaylistToCurrentTrack();
		},

		stopafter: function() {
			if (currentTrack.type == "stream") {
				infobar.error(language.gettext("label_notforradio"));
			} else if (player.status.state == "play") {
				if (player.status.single == 0) {
					player.controller.stopafter();
				} else {
					player.controller.cancelSingle();
				}

			}
		},

		previous: function() {
			if (currentalbum >= 0) {
				tracklist[currentalbum].previoustrackcommand();
			}
		},

		next: function() {
			if (currentalbum >= 0) {
				tracklist[currentalbum].nexttrackcommand();
			}
		},

		deleteGroup: function(index) {
			tracklist[index].deleteSelf();
		},

		addAlbumToCollection: function(index) {
			tracklist[index].addToCollection();
		},

		addFavourite: function(index) {
			debug.log("PLAYLIST","Adding Fave Station, index",index, tracklist[index].Album);
			var data = tracklist[index].getFnackle();
			yourRadioPlugin.addFave(data);
		},

		getCurrent: function(thing) {
			return currentTrack[thing];
		},

		getCurrentTrack: function() {
			return cloneObject(currentTrack);
		},

		setCurrent: function(items) {
			for (var i in items) {
				currentTrack[i] = items[i];
			}
		},

		getId: function(id) {
			for(var i in tracklist) {
				if (tracklist[i].findById(id) !== false) {
					return tracklist[i].getByIndex(tracklist[i].findById(id));
					break;
				}
			}
		},

		findIdByUri: function(uri) {
			for (var i in tracklist) {
				if (tracklist[i].findByUri(uri) !== false) {
					return tracklist[i].findByUri(uri);
					break;
				}
			}
			return false;
		},

		getAlbum: function(i) {
			debug.log("PLAYLIST","Getting Tracks For",i);
			return tracklist[i].getTracks();
		},

		getCurrentAlbum: function() {
			return currentalbum;
		},

		getDomainIcon: function(track, def) {
			var s = track.file.split(':');
			var d = s.shift();
			switch (d) {
				case "spotify":
				case "gmusic":
				case "youtube":
				case "internetarchive":
				case "soundcloud":
				case "podcast":
				case "dirble":
					return '<i class="icon-'+d+'-circled playlisticon fixed"></i>';
					break;

				case 'tunein':
					return '<i class="icon-tunein playlisticon fixed"></i>';
					break;
			}
			if (track.type == 'podcast') {
				return '<i class="icon-podcast-circled playlisticon fixed"></i>';
			}
			return def;
		},

		// Functions for moving things around by clicking icons
		// To be honest, if I hadn't decided to do trackgroups in the playlist
		// this would be a fuck of a lot easier. But then trackgroups simplify other things, so....

		moveTrackUp: function(element, event) {
			clearTimeout(popmovetimer);
			popmoveelement = element;
			var startoffset = uiHelper.getElementPlaylistOffset(element);
			var tracks = null;
			if (element.hasClass('item')) {
				tracks = element.next();
			}
			var p = element.findPreviousPlaylistElement();
			if (p.length > 0) {
				element.detach().insertBefore(p);
			}
			if (tracks !== null) {
				tracks.detach().insertAfter(element);
			}
			var offsetnow = uiHelper.getElementPlaylistOffset(element);
			var scrollnow = $('#pscroller').scrollTop();
			$('#pscroller').scrollTop(scrollnow+offsetnow-startoffset);
			popmovetimer = setTimeout(playlist.doPopMove, popmovetimeout);
		},

		moveTrackDown: function(element, event) {
			clearTimeout(popmovetimer);
			popmoveelement = element;
			var startoffset = uiHelper.getElementPlaylistOffset(element);
			var tracks = null;
			if (element.hasClass('item')) {
				tracks = element.next();
			}
			var n = element.findNextPlaylistElement();
			if (n.length > 0) {
				element.detach().insertAfter(n);
			}
			if (tracks !== null) {
				tracks.detach().insertAfter(element);
			}
			var offsetnow = uiHelper.getElementPlaylistOffset(element);
			var scrollnow = $('#pscroller').scrollTop();
			$('#pscroller').scrollTop(scrollnow+offsetnow-startoffset);
			popmovetimer = setTimeout(playlist.doPopMove, popmovetimeout);
		},

		doPopMove: function() {
			if (popmoveelement !== null) {
				if (popmoveelement.hasClass('item')) {
					popmoveelement.next().remove();
				}
				playlist.dragstopped(null, popmoveelement);
				popmoveelement = null;
			}
		},

		getCurrentTrackElement: function() {
			var scrollto = $('#sortable .playlistcurrentitem');
			if (!scrollto.is(':visible')) {
				scrollto = scrollto.parent().prev();
			}
			return scrollto;
		}

	}

}();

function Album(artist, album, index, rolledup) {

	var self = this;
	var tracks = [];
	this.artist = artist;
	this.album = album;
	this.index = index;

	this.newtrack = function (track) {
		tracks.push(track);
	}

	this.presentYourself = function() {
		var holder = $('<div>', { name: self.index, romprid: tracks[0].Id, class: 'item fullwidth sortable playlistalbum playlisttitle'}).appendTo('#sortable');
		if (self.index == playlist.getCurrentAlbum()) {
			holder.removeClass('playlisttitle').addClass('playlistcurrenttitle');
		}

		var inner = $('<div>', {class: 'containerbox'}).appendTo(holder);
		var albumDetails = $('<div>', {name: self.index, romprid: tracks[0].Id, class: 'expand clickplaylist playid containerbox vertcentre'}).appendTo(inner);

		if (prefs.use_albumart_in_playlist) {
			self.image = $('<img>', {class: 'smallcover fixed', name: tracks[0].ImgKey });
			self.image.on('error', self.getart);
			var imgholder = $('<div>', { class: 'smallcover fixed clickplaylist clickicon clickrollup', romprname: self.index}).appendTo(albumDetails);
			if (tracks[0].images.small) {
				self.image.attr('src', tracks[0].images.small).appendTo(imgholder);
			} else {
				if (tracks[0].Searched == 0) {
					self.image.addClass('notexist').appendTo(imgholder);
					self.getart();
				} else {
					self.image.addClass('notfound').appendTo(imgholder);
				}
			}
		}

		var title = $('<div>', {class: 'containerbox vertical expand'}).appendTo(albumDetails);
		title.append('<div class="bumpad">'+self.artist+'</div><div class="bumpad">'+self.album+'</div>');

		var controls = $('<div>', {class: 'containerbox vertical fixed'}).appendTo(inner)
		controls.append('<div class="expand clickplaylist clickicon clickremovealbum" name="'+self.index+'"><i class="icon-cancel-circled playlisticonr tooltip" title="'+language.gettext('label_removefromplaylist')+'"></i></div>');
		if (tracks[0].metadata.album.uri && tracks[0].metadata.album.uri.substring(0,7) == "spotify") {
			controls.append('<div class="fixed clickplaylist clickicon clickaddwholealbum" name="'+self.index+'"><i class="icon-music playlisticonr tooltip" title="'+language.gettext('label_addtocollection')+'"></i></div>');
		}

		var trackgroup = $('<div>', {class: 'trackgroup', name: self.index }).appendTo('#sortable');
		if (rolledup) {
			trackgroup.addClass('invisible');
		}
		for (var trackpointer in tracks) {
			var trackdiv = $('<div>', {name: tracks[trackpointer].Pos, romprid: tracks[trackpointer].Id, class: 'track sortable fullwidth playlistitem menuitem'}).appendTo(trackgroup);
			if (tracks[trackpointer].Id == player.status.songid) {
				trackdiv.removeClass('playlistitem').addClass('playlistcurrentitem');
			}

			var trackOuter = $('<div>', {class: 'containerbox dropdown-container'}).appendTo(trackdiv);
			var trackDetails = $('<div>', {class: 'expand playid clickplaylist containerbox dropdown-container', romprid: tracks[trackpointer].Id}).appendTo(trackOuter);

			if (tracks[trackpointer].Track) {
				var trackNodiv = $('<div>', {class: 'tracknumber fixed'}).appendTo(trackDetails);
				if (tracks.length > 99 || tracks[trackpointer].Track > 99) {
					trackNodiv.css('width', '3em');
				}
				trackNodiv.html(format_tracknum(tracks[trackpointer].Track));
			}

			trackDetails.append(playlist.getDomainIcon(tracks[trackpointer], ''));

			var trackinfo = $('<div>', {class: 'containerbox vertical expand'}).appendTo(trackDetails);
			trackinfo.append('<div class="line">'+tracks[trackpointer].Title+'</div>');
			if ((tracks[trackpointer].albumartist != "" && tracks[trackpointer].albumartist != tracks[trackpointer].trackartist)) {
				trackinfo.append('<div class="line playlistrow2">'+tracks[trackpointer].trackartist+'</div>');
			}
			if (tracks[trackpointer].metadata.track.usermeta) {
				if (tracks[trackpointer].metadata.track.usermeta.Rating > 0) {
					trackinfo.append('<div class="fixed playlistrow2 trackrating"><i class="icon-'+tracks[trackpointer].metadata.track.usermeta.Rating+'-stars rating-icon-small"></i></div>');
				}
				var t = tracks[trackpointer].metadata.track.usermeta.Tags.join(', ');
				if (t != '') {
					trackinfo.append('<div class="fixed playlistrow2 tracktags"><i class="icon-tags playlisticon"></i>'+t+'</div>');
				}
			}

			trackDetails.append('<div class="tracktime tiny fixed">'+formatTimeString(tracks[trackpointer].Time)+'</div>');
			trackOuter.append('<i class="icon-cancel-circled playlisticonr fixed clickplaylist clickicon clickremovetrack tooltip" title="'+language.gettext('label_removefromplaylist')+'" romprid="'+tracks[trackpointer].Id+'"></i>');

		}
	}

	this.getart = function() {
		coverscraper.GetNewAlbumArt({
			artist:     tracks[0].albumartist,
			album:      tracks[0].Album,
			mbid:       tracks[0].metadata.album.musicbrainz_id,
			albumpath:  tracks[0].folder,
			albumuri:   tracks[0].metadata.album.uri,
			imgkey:     tracks[0].ImgKey,
			type:       tracks[0].type,
			cb:         self.updateImages
		});
	}

	this.getFnackle = function() {
		return { album: tracks[0].Album,
				 image: tracks[0].images.small,
				 location: tracks[0].file,
				 stream: tracks[0].stream,
				 streamid: tracks[0].StreamIndex
		};
	}

	this.rollUp = function() {
		$('.trackgroup[name="'+self.index+'"]').slideToggle('slow');
		rolledup = !rolledup;
		if (rolledup) {
			playlist.rolledup[this.artist+this.album] = true;
		} else {
			playlist.rolledup[this.artist+this.album] = false;
		}
	}

	this.updateImages = function(data) {
		debug.debug("PLAYLIST","Updating track images with",data);
		for (var trackpointer in tracks) {
			tracks[trackpointer].images = data;
		}
	}

	this.getFirst = function() {
		return parseInt(tracks[0].Pos);
	}

	this.getSize = function() {
		return tracks.length;
	}

	this.isLast = function(id) {
		if (id == tracks[tracks.length - 1].Id) {
			return true;
		} else {
			return false;
		}
	}

	this.findcurrent = function(which) {
		for(var i in tracks) {
			if (tracks[i].Id == which) {
				return tracks[i];
			}
		}
		return false;
	}

	this.findById = function(which) {
		for(var i in tracks) {
			if (tracks[i].Id == which) {
				return i;
			}
		}
		return false;
	}

	this.findByUri = function(uri) {
		for(var i in tracks) {
			if (tracks[i].file == uri) {
				return tracks[i].Id;
			}
		}
		return false;
	}

	this.getByIndex = function(i) {
		return tracks[i];
	}

	this.getTracks = function() {
		return tracks;
	}

	this.getrest = function(id, arr) {
		var i = 0;
		if (id !== null) {
			while (i < tracks.length && tracks[i].Id != id) {
				i++;
			}
			i++;
		}
		while (i < tracks.length) {
			arr.push(tracks[i]);
			i++;
		}
	}

	this.deleteSelf = function() {
		var todelete = [];
		$('.item[name="'+self.index+'"]').next().remove();
		$('.item[name="'+self.index+'"]').remove();
		for(var i in tracks) {
			todelete.push(tracks[i].Id);
		}
		player.controller.removeId(todelete)
	}

	this.previoustrackcommand = function() {
		player.controller.previous();
	}

	this.nexttrackcommand = function() {
		player.controller.next();
	}

	this.addToCollection = function() {
		debug.log("PLAYLIST","Adding album to collection");
		if (tracks[0].metadata.album.uri && tracks[0].metadata.album.uri.substring(0,14) == "spotify:album:") {
			spotify.album.getInfo(tracks[0].metadata.album.uri.substring(14,tracks[0].metadata.album.uri.length),
			function(data) {
				metaHandlers.fromSpotifyData.addAlbumTracksToCollection(data, tracks[0].albumartist)
			},
			function(data) {
				debug.fail("ADD ALBUM","Failed to add album",data);
				infobar.error(language.gettext('label_general_error'));
			},
			false);
		} else {
			debug.error("PLAYLIST","Trying to add non-spotify album to the collection!");
		}
	}

	function format_tracknum(tracknum) {
		var r = /^(\d+)/;
		var result = r.exec(tracknum) || "";
		return result[1] || "";
	}

}

function Stream(index, album, rolledup) {
	var self = this;
	var tracks = [];
	this.index = index;
	var rolledup = rolledup;
	this.album = album;

	this.newtrack = function (track) {
		tracks.push(track);
	}

	this.presentYourself = function() {
		var header = $('<div>', {name: self.index, romprid: tracks[0].Id, class: 'item sortable fullwidth playlistalbum playlisttitle'}).appendTo('#sortable');
		if (self.index == playlist.getCurrentAlbum()) {
			header.removeClass('playlisttitle').addClass('playlistcurrenttitle');
		}

		var inner = $('<div>', {class: 'containerbox'}).appendTo(header);
		var albumDetails = $('<div>', {name: self.index, romprid: tracks[0].Id, class: 'expand playid clickplaylist containerbox vertcentre'}).appendTo(inner);

		if (prefs.use_albumart_in_playlist) {
			self.image = $('<img>', {class: 'smallcover fixed', name: tracks[0].ImgKey });
			self.image.on('error', self.getart);
			var imgholder = $('<div>', { class: 'smallcover fixed clickplaylist clickicon clickrollup', romprname: self.index}).appendTo(albumDetails);
			if (tracks[0].images.small) {
				self.image.attr('src', tracks[0].images.small).appendTo(imgholder);
			} else {
				if (tracks[0].Searched == 0) {
					self.image.addClass('notexist stream').appendTo(imgholder);
					if (tracks[0].album != rompr_unknown_stream) {
						self.getart();
					}
				} else {
					self.image.addClass('notfound').appendTo(imgholder);
				}
			}
		}

		var title = $('<div>', {class: 'containerbox vertical expand'}).appendTo(albumDetails);
		title.append('<div class="bumpad">'+tracks[0].Album+'</div>');
		var buttons = $('<div>', {class: 'containerbox vertical fixed'}).appendTo(inner);
		buttons.append('<div class="clickplaylist clickicon clickremovealbum expand" name="'+self.index+'"><i class="icon-cancel-circled playlisticonr tooltip" title="'+language.gettext('label_removefromplaylist')+'"></i></div>');
		buttons.append('<div class="clickplaylist clickicon clickaddfave fixed" name="'+self.index+'"><i class="icon-radio-tower playlisticonr tooltip" title="'+language.gettext('label_addtoradio')+'"></i></div>');

		var trackgroup = $('<div>', {class: 'trackgroup', name: self.index }).appendTo('#sortable');
		if (self.visible()) {
			trackgroup.addClass('invisible');
		}
		for (var trackpointer in tracks) {
			var trackdiv = $('<div>', {name: tracks[trackpointer].Pos, romprid: tracks[trackpointer].Id, class: 'booger playid clickplaylist containerbox playlistitem menuitem'}).appendTo(trackgroup);
			trackdiv.append(playlist.getDomainIcon(tracks[trackpointer], '<i class="icon-radio-tower playlisticon fixed"></i>'));
			var h = $('<div>', {class: 'containerbox vertical expand' }).appendTo(trackdiv);
			if (tracks[trackpointer].stream && tracks[trackpointer].stream != 'null') {
				h.append('<div class="playlistrow2 line">'+tracks[trackpointer].stream+'</div>');
			}
			h.append('<div class="tiny line">'+tracks[trackpointer].file+'</div>');
		}
	}

	this.getFnackle = function() {
		return { album: tracks[0].Album,
				 image: tracks[0].images.small,
				 location: tracks[0].file,
				 stream: tracks[0].stream,
				 streamid: tracks[0].StreamIndex
		};
	}

	this.findById = function(which) {
		for(var i in tracks) {
			if (tracks[i].Id == which) {
				return i;
			}
		}
		return false;
	}

	this.getByIndex = function(i) {
		return tracks[i];
	}

	this.getTracks = function() {
		return tracks;
	}

	this.rollUp = function() {
		$('.trackgroup[name="'+self.index+'"]').slideToggle('slow');
		if (self.visible()) {
			playlist.rolledup["StReAm"+this.album] = true;
		} else {
			playlist.rolledup["StReAm"+this.album] = false;
		}
		rolledup = !rolledup;
	}

	this.getFirst = function() {
		return parseInt(tracks[0].Pos);
	}

	this.getSize = function() {
		return tracks.length;
	}

	this.isLast = function(id) {
		if (id == tracks[tracks.length - 1].Id) {
			return true;
		} else {
			return false;
		}
	}

	this.findcurrent = function(which) {
		for(var i in tracks) {
			if (tracks[i].Id == which) {
				return tracks[i];
			}
		}
		return false;
	}

	this.findByUri = function(uri) {
		for(var i in tracks) {
			if (tracks[i].file == uri) {
				return tracks[i].Id;
			}
		}
		return false;
	}

	this.getrest = function(id, arr) {

	}

	this.getart = function() {
		coverscraper.GetNewAlbumArt({
			artist:     'STREAM',
			type:       'stream',
			album:      tracks[0].Album,
			imgkey:     tracks[0].ImgKey,
			cb:         self.updateImages
		});
	}

	this.updateImages = function(data) {
		debug.trace("PLAYLIST","Updating track images with",data);
		for (var trackpointer in tracks) {
			tracks[trackpointer].images = data;
		}
	}

	this.deleteSelf = function() {
		var todelete = [];
		for(var i in tracks) {
			$('.booger[name="'+tracks[i].Pos+'"]').remove();
			todelete.push(tracks[i].Id);
		}
		$('.item[name="'+self.index+'"]').remove();
		player.controller.removeId(todelete)
	}

	this.previoustrackcommand = function() {
		player.controller.playByPosition(parseInt(tracks[0].Pos)-1);
	}

	this.nexttrackcommand = function() {
		player.controller.playByPosition(parseInt(tracks[(tracks.length)-1].Pos)+1);
	}

	this.visible = function() {
		if (self.album == rompr_unknown_stream) {
			return !rolledup;
		} else {
			return rolledup;
		}
	}
}

jQuery.fn.findNextPlaylistElement = function() {
	var next = $(this).next();
	while (next.length > 0 && !next.is(':visible')) {
		next = next.next();
	}
	if (next.length == 0 && $(this).parent().hasClass('trackgroup')) {
		next = $(this).parent().next();
	}
	if (next.hasClass('item')) {
		if (next.next().is(':hidden')) {
			next = next.next();
		} else {
			next = next.next().children().first();
		}
	}
	return next;
}

jQuery.fn.findPreviousPlaylistElement = function() {
	var prev = $(this).prev();
	while (prev.length >0 && !prev.is(':visible')) {
		prev = prev.prev();
	}
	if (prev.length == 0 && $(this).parent().hasClass('trackgroup')) {
		prev = $(this).parent().prev().prev();
	}
	if (prev.hasClass('trackgroup')) {
		if (prev.is(':hidden')) {
			prev = prev.prev();
		} else {
			prev = prev.children().last();
		}
	}
	return prev;
}
