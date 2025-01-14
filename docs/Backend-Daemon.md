# The RompЯ Backend Daemon

## What Is It and Why?

The RompЯ Backend Daemon is a small program that needs to be running on the same computer as your webserver. It takes care of some operations
that can't be done if the browser is closed while music is playing, or if you are running RompЯ on a Phone or Tablet and the device goes to sleep.

## Important Note If Upgrading From Version 1.61 or earlier

If you are upgrading from an earlier version of RompЯ and you were running the program called romonitor, this Daemon replaces it.
Before doing the following you MUST do

	sudo systemctl stop romonitor
	sudo systemctl disable romonitor

If you were using multiple players before, you need to stop and disable all your romonitor processes. This new Daemon will
take care of creating romonitor processes for you, enabling them on the fly if you create new players.

If you were previously using romonitor to scrobble to last.FM, then you now need to go to the Prefs Panel and enable scrobbling from there.

## What It Does

* Scrobbles Tracks to Last.FM (1)
* Handles Automatically Refreshing Podcasts. (2)
* Runs the Sleep Timer and the Alarm Clock (3)
* Updates Playcounts
* Syncs Playcounts from Last.FM
* Tidies the Backend Cache
* Checks for unplayable/relinked Spotify tracks
* When you're using Mopidy it takes care of consuming the tracklist, because Mopidy's consume is broken.
* Runs Personalised Radio Stations

(1) Note this is a breaking change. Scrobbling used to be done from the browser or alternatively from the program
called romonitor that was in older versions of RompЯ. Scrobbling will not now work without the Backend Daemon.
The Daemon will honour the setting for Scrobbling in the Prefs panel.

(2) This is also a breaking change. This used to be done from the browser and was flaky, especially when using mobile devices.
If you are using a regular cron job or similar that calls Rompr's API to refresh your podcasts this will no longer be necessary.

(3) This is a change from previous versions. You no longer need to keep a browser open for these to work, and they
are now supported in the Phone skin.

## How To Run It

It's really very simple.

On most systems, RompR will take care of running the backend Daemon by itself the first time you open a browser on RompR. You do not need to do anything.

### On Systems Where RompR can not start it automatically.

On some systems though, for whatever reason, RompR may not be able to start it by itself and will show you an
error page when you try to open RompR. On those system you will need to create a systemd service.

![](images/nodaemon.png)

If you get an error screen that tells you the Daemon is not running then you need to create a service.
*Do not try to start the Daemon before you have seen the error screen*
This is because, until you get to that point, your database has not been initialised and the Daemon will not start.

Once you're there you just need to create a systemd service to run the process, as follows:

Just create a file /lib/systemd/system/rombackend.service that looks like this.
On some distros (eg Arch/Manjaro) this file might need to go in /etc/systemd/system/

    [Unit]
    Description=RompR Backend Daemon
    After=avahi-daemon.service
    After=dbus.service
    After=network.target
    After=nss-lookup.target
    After=remote-fs.target
    After=sound.target
    After=mariadb.service
    After=mysql.service
    After=nginx.service
    After=mpd.service
    After=mopidy.service

    [Service]
    User=www-data
    PermissionsStartOnly=true
    WorkingDirectory=/PATH/TO_ROMPR
    Restart=on-failure
    RestartSec=5s
    ExecStart=/usr/bin/php /PATH/TO/ROMPR/rompr_backend.php

    [Install]
    WantedBy=multi-user.target

You need to make some changes to that:

* **/PATH/TO/ROMPR** is the full path to your RompЯ installation. Refer to the installation instructions for more details.
* **User=** must be set to the username your web server runs as. On Debian/Ubuntu systems this is www-data

Then enable it with

    sudo systemctl enable rombackend.service

And start it with

    sudo systemctl start rombackend

** NOTE: if you run the Daemon in this way, the next time you upgrade to a new version of RompR, RompR will attempt to restart the Daemon.
As this will fail (or why are you running it as a service?) you will see the error that it is not running again.
Systemd should restart it after 5 seconds and then you'll be able to load RompR**

## Troubleshooting

If it's not working, first enable [debug logging](/RompR/Troubleshooting) to level 7 then restart rombackend.
You'll see some output from it in the web server's error log (and your custom logifle if you're using one).

You can also try to run it from the command-line with php /PATH/TO/ROMPR/rompr_backend.php, but if you do this it will need write access to your webserver's error log and everything in your rompr/prefs directory.
This might, however, be useful if it's crashing out really early.
