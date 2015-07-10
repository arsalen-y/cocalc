###############################################################################
#
# SageMathCloud: A collaborative web-based interface to Sage, IPython, LaTeX and the Terminal.
#
#    Copyright (C) 2014, William Stein
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU General Public License as published by
#    the Free Software Foundation, either version 3 of the License, or
#    (at your option) any later version.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU General Public License for more details.
#
#    You should have received a copy of the GNU General Public License
#    along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
###############################################################################

DEBUG = false

{EventEmitter} = require('events')

# don't delete the following -- even if not used below, since this needs
# to be available to page/ via browserify.
async       = require('async')
marked      = require('marked')
require('flummox'); require('flummox/component')
require('react')
exports.cjsx = require('coffee-react/node_modules/coffee-react-transform')
require('react-native-listener')
require('react-bootstrap')
require('react-timeago')
require('react-dropzone-component')

# end "don't delete"

underscore = require('underscore')

salvus_version = require('salvus_version')

diffsync = require('diffsync')
rethink_shared = require('rethink_shared')

message = require("message")
misc    = require("misc")

docs = require("docs")

defaults = misc.defaults
required = defaults.required

# JSON_CHANNEL is the channel used for JSON.  The hub imports this
# file, so if this constant is ever changed (for some reason?), it
# only has to be changed on this one line.  Moreover, channel
# assignment in the hub is implemented *without* the assumption that
# the JSON channel is '\u0000'.
JSON_CHANNEL = '\u0000'
exports.JSON_CHANNEL = JSON_CHANNEL # export, so can be used by hub

# Default timeout for many operations -- a user will get an error in many cases
# if there is no response to an operation after this amount of time.
DEFAULT_TIMEOUT = 30  # in seconds


# change these soon
git0 = 'git0'
gitls = 'git-ls'

class Session extends EventEmitter
    # events:
    #    - 'open'   -- session is initialized, open and ready to be used
    #    - 'close'  -- session's connection is closed/terminated
    #    - 'execute_javascript' -- code that server wants client to run related to this session
    constructor: (opts) ->
        opts = defaults opts,
            conn         : required     # a Connection instance
            project_id   : required
            session_uuid : required
            params       : undefined
            data_channel : undefined    # optional extra channel that is used for raw data
            init_history : undefined    # used for console

        @start_time   = misc.walltime()
        @conn         = opts.conn
        @params       = opts.params
        @project_id   = opts.project_id
        @session_uuid = opts.session_uuid
        @data_channel = opts.data_channel
        @init_history = opts.init_history
        @emit("open")

        ## This is no longer necessary; or rather, it's better to only
        ## reset terminals, etc., when they are used, since it wastes
        ## less resources.
        # I'm going to leave this in for now -- it's only used for console sessions,
        # and they aren't properly reconnecting in all cases.
        if @reconnect?
            @conn.on "connected", (() => setTimeout(@reconnect, 500))

    reconnect: (cb) =>
        # Called when the connection gets dropped, then reconnects
        if not @conn._signed_in? or not @conn._signed_in
            setTimeout(@reconnect, 500)
            return  # do *NOT* do cb?() yet!

        if @_reconnect_lock
            cb?("reconnect: hit lock")
            return

        @emit "reconnecting"
        @_reconnect_lock = true
        #console.log("reconnect: #{@type()} session with id #{@session_uuid}...")
        f = (cb) =>
            @conn.call
                message : message.connect_to_session
                    session_uuid : @session_uuid
                    type         : @type()
                    project_id   : @project_id
                    params       : @params
                timeout : 7
                cb      : (err, reply) =>
                    delete @_reconnect_lock
                    if err
                        cb(err); return
                    switch reply.event
                        when 'error'
                            cb(reply.error)
                        when 'session_connected'
                            #console.log("reconnect: #{@type()} session with id #{@session_uuid} -- SUCCESS")
                            if @data_channel != reply.data_channel
                                @conn.change_data_channel
                                    prev_channel : @data_channel
                                    new_channel  : reply.data_channel
                                    session      : @
                            @data_channel = reply.data_channel
                            @init_history = reply.history
                            @emit("reconnect")
                            cb()
                        else
                            cb("bug in hub")
        misc.retry_until_success
            max_time : 20000
            f        : f
            cb       : (err) => cb?(err)

    terminate_session: (cb) =>
        @conn.call
            message :
                message.terminate_session
                    project_id   : @project_id
                    session_uuid : @session_uuid
            timeout : 30
            cb      : cb

    walltime: () =>
        return misc.walltime() - @start_time

    handle_data: (data) =>
        @emit("data", data)

    write_data: (data) ->
        @conn.write_data(@data_channel, data)

    # default = SIGINT
    interrupt: (cb) ->
        tm = misc.mswalltime()
        if @_last_interrupt? and tm - @_last_interrupt < 100
            # client self-limit: do not send signals too frequently, since that wastes bandwidth and can kill the process
            cb?()
        else
            @_last_interrupt = tm
            @conn.call(message:message.send_signal(session_uuid:@session_uuid, signal:2), timeout:10, cb:cb)

    kill: (cb) ->
        @emit("close")
        @conn.call(message:message.send_signal(session_uuid:@session_uuid, signal:9), timeout:10, cb:cb)

    restart: (cb) =>
        @conn.call(message:message.restart_session(session_uuid:@session_uuid), timeout:10, cb:cb)


###
#
# A Sage session, which links the client to a running Sage process;
# provides extra functionality to kill/interrupt, etc.
#
#   Client <-- (primus) ---> Hub  <--- (tcp) ---> sage_server
#
###

class SageSession extends Session
    # If cb is given, it is called every time output for this particular code appears;
    # No matter what, you can always still listen in with the 'output' even, and note
    # the uuid, which is returned from this function.
    execute_code: (opts) ->
        opts = defaults opts,
            code     : required
            cb       : undefined
            data     : undefined
            preparse : true
            uuid     : undefined

        if opts.uuid?
            uuid = opts.uuid
        else
            uuid = misc.uuid()
        if opts.cb?
            @conn.execute_callbacks[uuid] = opts.cb

        @conn.send(
            message.execute_code
                id   : uuid
                code : opts.code
                data : opts.data
                session_uuid : @session_uuid
                preparse : opts.preparse
        )

        return uuid

    type: () => "sage"

    introspect: (opts) ->
        opts.session_uuid = @session_uuid
        @conn.introspect(opts)

###
#
# A Console session, which connects the client to a pty on a remote machine.
#
#   Client <-- (primus) ---> Hub  <--- (tcp) ---> console_server
#
###

class ConsoleSession extends Session
    type: () => "console"




class exports.Connection extends EventEmitter
    # Connection events:
    #    - 'connecting' -- trying to establish a connection
    #    - 'connected'  -- succesfully established a connection; data is the protocol as a string
    #    - 'error'      -- called when an error occurs
    #    - 'output'     -- received some output for stateless execution (not in any session)
    #    - 'execute_javascript' -- code that server wants client to run (not for a particular session)
    #    - 'message'    -- emitted when a JSON message is received           on('message', (obj) -> ...)
    #    - 'data'       -- emitted when raw data (not JSON) is received --   on('data, (id, data) -> )...
    #    - 'signed_in'  -- server pushes a succesful sign in to the client (e.g., due to
    #                      'remember me' functionality); data is the signed_in message.
    #    - 'project_list_updated' -- sent whenever the list of projects owned by this user
    #                      changed; data is empty -- browser could ignore this unless
    #                      the project list is currently being displayed.
    #    - 'project_data_changed - sent when data about a specific project has changed,
    #                      e.g., title/description/settings/etc.



    constructor: (@url) ->
        @setMaxListeners(100)   #TODO: lower this to <=10 and track down issues/remove leaks.
        @emit("connecting")
        @_id_counter       = 0
        @_sessions         = {}
        @_new_sessions     = {}
        @_data_handlers    = {}
        @execute_callbacks = {}
        @call_callbacks    = {}
        @_project_title_cache = {}
        @_usernames_cache = {}

        @register_data_handler(JSON_CHANNEL, @handle_json_data)

        # IMPORTANT! Connection is an abstract base class.  Derived classes must
        # implement a method called _connect that takes a URL and a callback, and connects to
        # the Primus websocket server with that url, then creates the following event emitters:
        #      "connected", "error", "close"
        # and returns a function to write raw data to the socket.
        @_connect @url, (data) =>
            if data.length > 0  # all messages must start with a channel; length 0 means nothing.
                # Incoming messages are tagged with a single UTF-16
                # character c (there are 65536 possibilities).  If
                # that character is JSON_CHANNEL, the message is
                # encoded as JSON and we handle it in the usual way.
                # If the character is anything else, the raw data in
                # the message is sent to an appropriate handler, if
                # one has previously been registered.  The motivation
                # is that we the ability to multiplex multiple
                # sessions over a *single* WebSocket connection, and it
                # is absolutely critical that there is minimal
                # overhead regarding the amount of data transfered --
                # 1 character is minimal!

                channel = data[0]
                data    = data.slice(1)

                @_handle_data(channel, data)

                # give other listeners a chance to do something with this data.
                @emit("data", channel, data)
        @_connected = false

        # start pinging -- not used/needed with primus
        #@_ping()

    _ping: () =>
        if not @_ping_interval?
            @_ping_interval = 10000 # frequency to ping
        @_last_ping = new Date()
        @call
            message : message.ping()
            timeout : 20  # 20 second timeout
            cb      : (err, pong) =>
                if not err and pong?.event == 'pong'
                    latency = new Date() - @_last_ping
                    @emit "ping", latency
                # try again later
                setTimeout(@_ping, @_ping_interval)

    ping_test: (opts) =>
        opts = defaults opts,
            packets  : 20
            timeout  : 5   # any ping that takes this long in seconds is considered a fail
            delay_ms : 200  # wait this long between doing pings
            log      : undefined  # if set, use this to log output
            cb       : undefined   # cb(err, ping_times)

        ###
        Use like this in a Sage Worksheet:

            %coffeescript
            s = require('salvus_client').salvus_client
            s.ping_test(delay_ms:100, packets:40, log:print)
        ###
        ping_times = []
        do_ping = (i, cb) =>
            t = new Date()
            @call
                message : message.ping()
                timeout : opts.timeout
                cb      : (err, pong) =>
                    heading = "#{i}/#{opts.packets}: "
                    if not err and pong?.event == 'pong'
                        ping_time = new Date() - t
                        bar = ('*' for j in [0...Math.floor(ping_time/10)]).join('')
                        mesg = "#{heading}time=#{ping_time}ms"
                    else
                        bar = "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
                        mesg = "#{heading}Request error -- #{err}, #{misc.to_json(pong)}"
                        ping_time = Infinity
                    while mesg.length < 40
                        mesg += ' '
                    mesg += bar
                    if opts.log?
                        opts.log(mesg)
                    else
                        console.log(mesg)
                    ping_times.push(ping_time)
                    setTimeout(cb, opts.delay_ms)
        async.mapSeries([1..opts.packets], do_ping, (err) => opts.cb?(err, ping_times))


    close: () ->
        @_conn.close()   # TODO: this looks very dubious -- probably broken or not used anymore

    # Send a JSON message to the hub server.
    send: (mesg) ->
        #console.log("send at #{misc.mswalltime()}", mesg)
        @write_data(JSON_CHANNEL, misc.to_json(mesg))

    # Send raw data via certain channel to the hub server.
    write_data: (channel, data) =>
        try
            @_write(channel + data)
        catch err
            # TODO: this happens when trying to send and the client not connected
            # We might save up messages in a local queue and keep retrying, for
            # a sort of offline mode ?  I have not worked out how to handle this yet.
            #console.log(err)

    is_signed_in: -> !!@_signed_in

    handle_json_data: (data) =>
        mesg = misc.from_json(data)
        if DEBUG
            console.log("handle_json_data: #{data}")
        switch mesg.event
            when "execute_javascript"
                if mesg.session_uuid?
                    @_sessions[mesg.session_uuid].emit("execute_javascript", mesg)
                else
                    @emit("execute_javascript", mesg)
            when "output"
                cb = @execute_callbacks[mesg.id]
                if cb?
                    cb(mesg)
                    delete @execute_callbacks[mesg.id] if mesg.done
                if mesg.session_uuid?  # executing in a persistent session
                    @_sessions[mesg.session_uuid].emit("output", mesg)
                else   # stateless exec
                    @emit("output", mesg)
            when "terminate_session"
                session = @_sessions[mesg.session_uuid]
                session?.emit("close")
            when "session_reconnect"
                if mesg.data_channel?
                    @_sessions[mesg.data_channel]?.reconnect()
                else if mesg.session_uuid?
                    @_sessions[mesg.session_uuid]?.reconnect()
            when "cookies"
                @_cookies?(mesg)
            when "signed_in"
                @account_id = mesg.account_id
                @_signed_in = true
                if localStorage?
                    localStorage['remember_me'] = mesg.email_address
                @emit("signed_in", mesg)
            when "remember_me_failed"
                if localStorage?
                    delete localStorage['remember_me']
                @emit(mesg.event, mesg)
            when "project_list_updated", 'project_data_changed'
                @emit(mesg.event, mesg)
            when "codemirror_diffsync_ready"
                @emit(mesg.event, mesg)
            when "codemirror_bcast"
                @emit(mesg.event, mesg)
            when "activity_notifications"  # deprecated
                @emit(mesg.event, mesg)
            when "recent_activity"
                @emit(mesg.event, mesg.updates)
            when "error"
                # An error that isn't tagged with an id -- some sort of general problem.
                if not mesg.id?
                    console.log("WARNING: #{mesg.error}")
                    return

        id = mesg.id  # the call f(null,mesg) can mutate mesg (!), so we better save the id here.
        v = @call_callbacks[id]
        if v?
            {cb, error_event} = v
            if error_event and mesg.event == 'error'
                cb(mesg.error)
            else
                cb(undefined, mesg)
            if not mesg.multi_response
                delete @call_callbacks[id]

        # Finally, give other listeners a chance to do something with this message.
        @emit('message', mesg)

    change_data_channel: (opts) =>
        opts = defaults opts,
            prev_channel : required
            new_channel  : required
            session      : required
        @unregister_data_handler(opts.prev_channel)
        delete @_sessions[opts.prev_channel]
        @_sessions[opts.new_channel] = opts.session
        @register_data_handler(opts.new_channel, opts.session.handle_data)

    register_data_handler: (channel, h) ->
        @_data_handlers[channel] = h

    unregister_data_handler: (channel) ->
        delete @_data_handlers[channel]

    _handle_data: (channel, data) =>
        #console.log("_handle_data:(#{channel},'#{data}')")
        f = @_data_handlers[channel]
        if f?
            f(data)
        #else
        #    console.log("Error -- missing channel '#{channel}' for data '#{data}'.  @_data_handlers = #{misc.to_json(@_data_handlers)}")

    connect_to_session: (opts) ->
        opts = defaults opts,
            type         : required
            session_uuid : required
            project_id   : required
            timeout      : DEFAULT_TIMEOUT
            params  : undefined   # extra params relevant to the session (in case we need to restart it)
            cb           : required
        @call
            message : message.connect_to_session
                session_uuid : opts.session_uuid
                type         : opts.type
                project_id   : opts.project_id
                params       : opts.params

            timeout : opts.timeout

            cb      : (error, reply) =>
                if error
                    opts.cb(error); return
                switch reply.event
                    when 'error'
                        opts.cb(reply.error)
                    when 'session_connected'
                        @_create_session_object
                            type         : opts.type
                            project_id   : opts.project_id
                            session_uuid : opts.session_uuid
                            data_channel : reply.data_channel
                            init_history : reply.history
                            params       : opts.params
                            cb           : opts.cb
                    else
                        opts.cb("Unknown event (='#{reply.event}') in response to connect_to_session message.")

    new_session: (opts) ->
        opts = defaults opts,
            timeout : DEFAULT_TIMEOUT          # how long until give up on getting a new session
            type    : "sage"      # "sage", "console"
            params  : undefined   # extra params relevant to the session
            project_id : undefined # project that this session starts in (TODO: make required)
            cb      : required    # cb(error, session)  if error is defined it is a string

        @call
            message : message.start_session
                type       : opts.type
                params     : opts.params
                project_id : opts.project_id

            timeout : opts.timeout

            cb      : (error, reply) =>
                if error
                    opts.cb(error)
                else
                    if reply.event == 'error'
                        opts.cb(reply.error)
                    else if reply.event == "session_started" or reply.event == "session_connected"
                        @_create_session_object
                            type         : opts.type
                            project_id   : opts.project_id
                            session_uuid : reply.session_uuid
                            data_channel : reply.data_channel
                            cb           : opts.cb
                    else
                        opts.cb("Unknown event (='#{reply.event}') in response to start_session message.")


    _create_session_object: (opts) =>
        opts = defaults opts,
            type         : required
            project_id   : required
            session_uuid : required
            data_channel : undefined
            params       : undefined
            init_history : undefined
            cb           : required

        session_opts =
            conn         : @
            project_id   : opts.project_id
            session_uuid : opts.session_uuid
            data_channel : opts.data_channel
            init_history : opts.init_history
            params       : opts.params

        switch opts.type
            when 'sage'
                session = new SageSession(session_opts)
            when 'console'
                session = new ConsoleSession(session_opts)
            else
                opts.cb("Unknown session type: '#{opts.type}'")
        @_sessions[opts.session_uuid] = session
        if opts.data_channel != JSON_CHANNEL
            @_sessions[opts.data_channel] = session
        @register_data_handler(opts.data_channel, session.handle_data)
        opts.cb(false, session)

    execute_code: (opts={}) ->
        opts = defaults(opts, code:defaults.required, cb:null, preparse:true, allow_cache:true, data:undefined)
        uuid = misc.uuid()
        if opts.cb?
            @execute_callbacks[uuid] = opts.cb
        @send(message.execute_code(id:uuid, code:opts.code, preparse:opts.preparse, allow_cache:opts.allow_cache, data:opts.data))
        return uuid

    # introspection
    introspect: (opts) ->
        opts = defaults opts,
            line          :  required
            timeout       :  DEFAULT_TIMEOUT          # max time to wait in seconds before error
            session_uuid  :  required
            preparse      :  true
            cb            :  required  # pointless without a callback

        mesg = message.introspect
            line         : opts.line
            session_uuid : opts.session_uuid
            preparse     : opts.preparse

        @call
            message : mesg
            timeout : opts.timeout
            cb      : opts.cb

    call: (opts={}) =>
        # This function:
        #    * Modifies the message by adding an id attribute with a random uuid value
        #    * Sends the message to the hub
        #    * When message comes back with that id, call the callback and delete it (if cb opts.cb is defined)
        #      The message will not be seen by @handle_message.
        #    * If the timeout is reached before any messages come back, delete the callback and stop listening.
        #      However, if the message later arrives it may still be handled by @handle_message.
        opts = defaults opts,
            message     : required
            timeout     : undefined
            error_event : false  # if true, turn error events into just a normal err
            cb          : undefined
        if not opts.cb?
            @send(opts.message)
            return
        if not opts.message.id?
            id = misc.uuid()
            opts.message.id = id
        else
            id = opts.message.id

        @call_callbacks[id] =
            cb          : opts.cb
            error_event : opts.error_event

        @send(opts.message)
        if opts.timeout
            setTimeout(
                (() =>
                    if @call_callbacks[id]?
                        error = "Timeout after #{opts.timeout} seconds"
                        opts.cb(error, message.error(id:id, error:error))
                        delete @call_callbacks[id]
                ), opts.timeout*1000
            )

    call_local_hub: (opts) =>
        opts = defaults opts,
            project_id : required    # determines the destination local hub
            message    : required
            multi_response : false
            timeout    : undefined
            cb         : undefined
        m = message.local_hub
                multi_response : opts.multi_response
                project_id : opts.project_id
                message    : opts.message
                timeout    : opts.timeout
        if opts.cb?
            f = (err, resp) =>
                #console.log("call_local_hub:#{misc.to_json(opts.message)} got back #{misc.to_json(err:err,resp:resp)}")
                opts.cb?(err, resp)
        else
            f = undefined

        if opts.multi_response
            m.id = misc.uuid()
            #console.log("setting up execute callback on id #{m.id}")
            @execute_callbacks[m.id] = (resp) =>
                #console.log("execute_callback: ", resp)
                opts.cb?(undefined, resp)
            @send(m)
        else
            @call
                message : m
                timeout : opts.timeout
                cb      : f


    #################################################
    # Version
    #################################################
    server_version: (opts) =>
        opts = defaults opts,
            cb : required
        ($.get "/static/salvus_version.js", (data) =>
            opts.cb(undefined, parseInt(data.split('=')[1]))).fail (err) =>
                opts.cb("failed to get version -- #{err}")
        # the following is an older socket version; the above is better since it
        # even works if we're switching protocols (e.g., between websocket and engine.io)
        ###
        @call
            message : message.get_version()
            cb      : (err, mesg) =>
                opts.cb(err, mesg.version)
        ###

    #################################################
    # Stats
    #################################################
    server_stats: (opts) =>
        opts = defaults opts,
            cb : required
        @call
            message : message.get_stats()
            cb      : (err, mesg) =>
                if err
                    opts.cb(err)
                else if mesg.event == 'error'
                    opts.cb(mesg.error)
                else
                    opts.cb(err, mesg.stats)

    #################################################
    # Account Management
    #################################################
    create_account: (opts) =>
        opts = defaults opts,
            first_name     : required
            last_name      : required
            email_address  : required
            password       : required
            agreed_to_terms: required
            token          : undefined       # only required if an admin set the account creation token.
            timeout        : 15
            cb             : required

        if not opts.agreed_to_terms
            opts.cb(undefined, message.account_creation_failed(reason:{"agreed_to_terms":"Agree to the Salvus Terms of Service."}))
            return

        @call
            message : message.create_account
                first_name      : opts.first_name
                last_name       : opts.last_name
                email_address   : opts.email_address
                password        : opts.password
                agreed_to_terms : opts.agreed_to_terms
                token           : opts.token
            timeout : opts.timeout
            cb      : opts.cb

    sign_in: (opts) ->
        opts = defaults opts,
            email_address : required
            password      : required
            remember_me   : false
            cb            : required
            timeout       : 15

        @call
            message : message.sign_in
                email_address : opts.email_address
                password      : opts.password
                remember_me   : opts.remember_me
            timeout : opts.timeout
            cb      : opts.cb

    sign_out: (opts) ->
        opts = defaults opts,
            everywhere   : false
            cb           : undefined
            timeout      : DEFAULT_TIMEOUT # seconds

        @account_id = undefined

        @call
            message : message.sign_out(everywhere:opts.everywhere)
            timeout : opts.timeout
            cb      : opts.cb

    change_password: (opts) ->
        opts = defaults opts,
            email_address : required
            old_password  : ""
            new_password  : required
            cb            : undefined
        @call
            message : message.change_password
                email_address : opts.email_address
                old_password  : opts.old_password
                new_password  : opts.new_password
            cb : opts.cb

    change_email: (opts) ->
        opts = defaults opts,
            account_id        : required
            old_email_address : ""
            new_email_address : required
            password          : ""
            cb                : undefined

        @call
            message: message.change_email_address
                account_id        : opts.account_id
                old_email_address : opts.old_email_address
                new_email_address : opts.new_email_address
                password          : opts.password
            error_event : true
            cb : opts.cb

    # forgot password -- send forgot password request to server
    forgot_password: (opts) ->
        opts = defaults opts,
            email_address : required
            cb            : required
        @call
            message: message.forgot_password
                email_address : opts.email_address
            cb: opts.cb

    # forgot password -- send forgot password request to server
    reset_forgot_password: (opts) ->
        opts = defaults(opts,
            reset_code    : required
            new_password  : required
            cb            : required
            timeout       : DEFAULT_TIMEOUT # seconds
        )
        @call(
            message : message.reset_forgot_password(reset_code:opts.reset_code, new_password:opts.new_password)
            cb      : opts.cb
        )

    # cb(false, message.account_settings), assuming this connection has logged in as that user, etc..  Otherwise, cb(error).
    get_account_settings: (opts) ->
        opts = defaults opts,
            account_id : required
            cb         : required
        # this lock is basically a temporary ugly hack
        if @_get_account_settings_lock
            console.log("WARNING: hit account settings lock")
            opts.cb("already getting account settings")
            return
        @_get_account_settings_lock = true
        f = () =>
            delete @_get_account_settings_lock
        setTimeout(f, 3000)

        @call
            message : message.get_account_settings(account_id: opts.account_id)
            timeout : DEFAULT_TIMEOUT
            cb      : (err, settings) =>
                delete @_get_account_settings_lock
                opts.cb(err, settings)

    # forget about a given passport authentication strategy for this user
    unlink_passport: (opts) ->
        opts = defaults opts,
            strategy : required
            id       : required
            cb       : undefined
        @call
            message : message.unlink_passport
                strategy : opts.strategy
                id       : opts.id
            error_event : true
            timeout : 15
            cb : opts.cb

    ############################################
    # User Feedback
    #############################################
    report_feedback: (opts={}) ->
        opts = defaults opts,
            category    : required
            description : required
            nps         : undefined
            cb          : undefined

        @call
            message: message.report_feedback
                category    : opts.category
                description : opts.description
                nps         : opts.nps
            cb     : opts.cb

    feedback: (opts={}) ->
        opts = defaults opts,
            cb : required
        @call
            message: message.get_all_feedback_from_user()
            cb : (err, results) ->
                opts.cb(err, misc.from_json(results?.data))

    #################################################
    # Project Management
    #################################################
    create_project: (opts) =>
        opts = defaults opts,
            title       : required
            description : required
            public      : required
            cb          : undefined
        @call
            message: message.create_project(title:opts.title, description:opts.description, public:opts.public)
            cb     : (err, resp) =>
                if err
                    opts.cb?(err)
                else if resp.event == 'error'
                    opts.cb?(resp.error)
                else
                    opts.cb?(undefined, resp.project_id)

    get_projects: (opts) =>
        opts = defaults opts,
            hidden : false
            cb : required
        @call
            message : message.get_projects(hidden:opts.hidden)
            cb      : (err, mesg) =>
                if not err and mesg.event == 'all_projects'
                    for project in mesg.projects
                        @_project_title_cache[project.project_id] = project.title
                        collabs = project.collaborator
                        if collabs?
                            for collab in collabs
                                if not @_usernames_cache[collab.account_id]?
                                    @_usernames_cache[collab.account_id] = collab
                opts.cb(err, mesg)

    #################################################
    # Individual Projects
    #################################################

    project_info: (opts) ->
        opts = defaults opts,
            project_id : required
            cb         : required
        @call
            message : message.get_project_info(project_id : opts.project_id)
            cb      : (err, resp) =>
                if err
                    opts.cb(err)
                else if resp.event == 'error'
                    opts.cb(resp.error)
                else
                    @_project_title_cache[opts.project_id] = resp.info.title
                    opts.cb(undefined, resp.info)

    # Return info about all sessions that have been started in this
    # project, since the local hub was started.
    project_session_info: (opts) ->
        opts = defaults opts,
            project_id : required
            cb         : required
        @call
            message : message.project_session_info(project_id : opts.project_id)
            cb      : (err, resp) =>
                opts.cb(err, resp?.info)

    update_project_data: (opts) ->
        opts = defaults opts,
            project_id : required
            data       : required
            timeout    : DEFAULT_TIMEOUT
            cb         : undefined    # cb would get project_data_updated message back, as does everybody else with eyes on this project
        @call
            message: message.update_project_data(project_id:opts.project_id, data:opts.data)
            cb : opts.cb

    open_project: (opts) ->
        opts = defaults opts,
            project_id   : required
            cb           : required
        @call
            message :
                message.open_project
                    project_id : opts.project_id
            cb : opts.cb

    close_project: (opts) ->
        opts = defaults opts,
            project_id  : required
            cb          : undefined
        @call
            message :
                message.close_project
                    project_id  : opts.project_id
            cb : opts.cb

    delete_project: (opts) =>
        opts = defaults opts,
            project_id : required
            timeout    : DEFAULT_TIMEOUT
            cb         : undefined
        @call
            message :
                message.delete_project
                    project_id  : opts.project_id
            timeout : opts.timeout
            cb : opts.cb

    undelete_project: (opts) =>
        opts = defaults opts,
            project_id : required
            timeout    : DEFAULT_TIMEOUT
            cb         : undefined
        @call
            message :
                message.undelete_project
                    project_id  : opts.project_id
            timeout : opts.timeout
            cb : opts.cb

    # hide the given project from this user
    hide_project_from_user: (opts) =>
        opts = defaults opts,
            project_id : required
            account_id : undefined   # if given hide from this user -- only owner can hide projects from other users
            cb         : undefined
        @call
            message :
                message.hide_project_from_user
                    project_id  : opts.project_id
                    account_id  : opts.account_id
            cb : opts.cb

    # unhide the given project from this user
    unhide_project_from_user: (opts) =>
        opts = defaults opts,
            project_id : required
            account_id : undefined   # if given hide from this user -- only owner can hide projects from other users
            cb         : undefined
        @call
            message :
                message.unhide_project_from_user
                    project_id  : opts.project_id
                    account_id  : opts.account_id
            cb : opts.cb

    move_project: (opts) =>
        opts = defaults opts,
            project_id : required
            timeout    : 60*15              # 15 minutes -- since moving a project is potentially time consuming.
            target     : undefined          # optional target; if given will attempt to move to the given host
            cb         : undefined          # cb(err, new_location)
        @call
            message :
                message.move_project
                    project_id  : opts.project_id
                    target      : opts.target
            timeout : opts.timeout
            cb      : (err, resp) =>
                if err
                    opts.cb(err)
                else if resp.event == 'error'
                    opts.cb(resp.error)
                else
                    opts.cb(false, resp.location)

    write_text_file_to_project: (opts) ->
        opts = defaults opts,
            project_id : required
            path       : required
            content    : required
            timeout    : DEFAULT_TIMEOUT
            cb         : undefined

        @call
            message :
                message.write_text_file_to_project
                    project_id : opts.project_id
                    path       : opts.path
                    content    : opts.content
            timeout : opts.timeout
            cb      : (err, resp) => opts.cb?(err, resp)

    read_text_file_from_project: (opts) ->
        opts = defaults opts,
            project_id : required
            path       : required
            cb         : required
            timeout    : DEFAULT_TIMEOUT

        @call
            message :
                message.read_text_file_from_project
                    project_id : opts.project_id
                    path       : opts.path
            timeout : opts.timeout
            cb : opts.cb

    # Like "read_text_file_from_project" above, except the callback
    # message gives a temporary url from which the file can be
    # downloaded using standard AJAX.
    read_file_from_project: (opts) ->
        opts = defaults opts,
            project_id : required
            path       : required
            timeout    : DEFAULT_TIMEOUT
            archive    : 'tar.bz2'   # NOT SUPPORTED ANYMORE! -- when path is a directory: 'tar', 'tar.bz2', 'tar.gz', 'zip', '7z'
            cb         : required

        base = window?.salvus_base_url  # will be defined in web browser
        if not base?
            base = ''
        if opts.path[0] == '/'
            # absolute path to the root
            if base != ''
                opts.path = '.sagemathcloud-local/root' + opts.path  # use root symlink, which is created by start_smc
            else
                opts.path = '.sagemathcloud/root' + opts.path  # use root symlink, which is created by start_smc

        url = misc.encode_path("#{base}/#{opts.project_id}/raw/#{opts.path}")

        opts.cb(false, {url:url})
        # This is the old hub/database version -- too slow, and loads the database/server, way way too much.
        ###
        @call
            timeout : opts.timeout
            message :
                message.read_file_from_project
                    project_id : opts.project_id
                    path       : opts.path
                    archive    : opts.archive
            cb : opts.cb
        ###

    move_file_in_project: (opts) ->
        opts = defaults opts,
            project_id : required
            src        : required
            dest       : required
            cb         : required
        @call
            message :
                message.move_file_in_project
                    project_id : opts.project_id
                    src        : opts.src
                    dest       : opts.dest
            cb : opts.cb

    make_directory_in_project: (opts) ->
        opts = defaults opts,
            project_id : required
            path       : required
            cb         : required
        @call
            message :
                message.make_directory_in_project
                    project_id : opts.project_id
                    path       : opts.path
            cb : opts.cb

    # remove_file_from_project: (opts) ->
    #     opts = defaults opts,
    #         project_id : required
    #         path       : required
    #         cb         : required
    #     @call
    #         message :
    #             message.remove_file_from_project
    #                 project_id : opts.project_id
    #                 path       : opts.path
    #         cb : opts.cb

    move_file_in_project: (opts) ->
        opts = defaults opts,
            project_id : required
            src        : required
            dest       : required
            cb         : required
        @call
            message :
                message.move_file_in_project
                    project_id : opts.project_id
                    src        : opts.src
                    dest       : opts.dest
            cb : opts.cb

    project_branch_op: (opts) ->
        opts = defaults opts,
            project_id : required
            branch     : required
            op         : required
            cb         : required
        @call
            message : message["#{opts.op}_project_branch"]
                project_id : opts.project_id
                branch     : opts.branch
            cb : opts.cb


    stopped_editing_file: (opts) =>
        opts = defaults opts,
            project_id : required
            filename   : required
            cb         : undefined
        @call
            message : message.stopped_editing_file
                project_id : opts.project_id
                filename   : opts.filename
            cb      : opts.cb

    invite_noncloud_collaborators: (opts) =>
        opts = defaults opts,
            project_id : required
            to         : required
            email      : required
            cb         : required

        @call
            message: message.invite_noncloud_collaborators
                project_id : opts.project_id
                email      : opts.email
                to         : opts.to
            cb : (err, resp) =>
                if err
                    opts.cb(err)
                else if resp.event == 'error'
                    if not resp.error
                        resp.error = "error inviting collaborators"
                    opts.cb(resp.error)
                else
                    opts.cb(undefined, resp)

    copy_path_between_projects: (opts) =>
        opts = defaults opts,
            public            : false
            src_project_id    : required    # id of source project
            src_path          : required    # relative path of director or file in the source project
            target_project_id : required    # if of target project
            target_path       : undefined   # defaults to src_path
            overwrite_newer   : false       # overwrite newer versions of file at destination (destructive)
            delete_missing    : false       # delete files in dest that are missing from source (destructive)
            timeout           : undefined   # how long to wait for the copy to complete before reporting "error" (though it could still succeed)
            cb                : undefined   # cb(err)

        is_public = opts.public
        delete opts.public
        cb = opts.cb
        delete opts.cb

        if not opts.target_path?
            opts.target_path = opts.src_path

        if is_public
            mesg = message.copy_public_path_between_projects(opts)
        else
            mesg = message.copy_path_between_projects(opts)

        @call
            message : mesg
            cb      : (err, resp) =>
                if err
                    cb?(err)
                else if resp.event == 'error'
                    cb?(resp.error)
                else
                    cb?(undefined, resp)

    # Set a quota parameter for a given project.
    # As of now, only user in the admin group can make these changes.
    project_set_quotas: (opts) =>
        opts = defaults opts,
            project_id : required
            memory     : undefined    # see message.coffee for the units, etc., for all these settings
            cpu_shares : undefined
            cores      : undefined
            disk       : undefined
            mintime    : undefined
            network    : undefined
            cb         : undefined
        cb = opts.cb
        delete opts.cb

        @call
            message : message.project_set_quotas(opts)
            cb      : (err, resp) =>
                if err
                    cb?(err)
                else if resp.event == 'error'
                    cb?(resp.error)
                else
                    cb?(undefined, resp)

    #################################################
    # Blobs
    #################################################
    remove_blob_ttls: (opts) =>
        opts = defaults opts,
            uuids : required   # list of sha1 hashes of blobs stored in the blobstore
            cb    : undefined
        if opts.uuids.length == 0
            opts.cb?()
        else
            @call
                message :
                    message.remove_blob_ttls
                        uuids : opts.uuids
                cb : (err, resp) =>
                    if err
                        opts.cb?(err)
                    else if resp.event == 'error'
                        opts.cb?(resp.error)
                    else
                        opts.cb?()


    #################################################
    # *PUBLIC* Projects
    #################################################
    public_project_info: (opts) =>
        opts = defaults opts,
            project_id : required
            cb         : required
            timeout    : DEFAULT_TIMEOUT
        @call
            message :
                message.public_get_project_info
                    project_id : opts.project_id
            timeout : opts.timeout
            cb      : (err, resp) =>
                if err
                    opts.cb(err)
                else if resp.event == 'error'
                    opts.cb(resp.error)
                else
                    opts.cb(undefined, resp.info)

    public_get_text_file: (opts) =>
        opts = defaults opts,
            project_id : required
            path       : required
            cb         : required
            timeout    : DEFAULT_TIMEOUT

        @call
            message :
                message.public_get_text_file
                    project_id : opts.project_id
                    path       : opts.path
            timeout : opts.timeout
            cb      : (err, resp) =>
                if err
                    opts.cb(err)
                else if resp.event == 'error'
                    opts.cb(resp.error)
                else
                    opts.cb(undefined, resp.data)

    public_project_directory_listing: (opts) =>
        opts = defaults opts,
            project_id : required
            path       : '.'
            time       : false
            start      : 0
            limit      : -1
            timeout    : DEFAULT_TIMEOUT
            hidden     : false
            cb         : required
        @call
            message :
                message.public_get_directory_listing
                    project_id : opts.project_id
                    path       : opts.path
                    time       : opts.time
                    start      : opts.tart
                    limit      : opts.limit
                    hidden     : opts.hidden
            timeout : opts.timeout
            cb      : (err, resp) =>
                if err
                    opts.cb(err)
                else if resp.event == 'error'
                    opts.cb(resp.error)
                else
                    opts.cb(undefined, resp.result)

    publish_path: (opts) =>
        opts = defaults opts,
            project_id  : required
            path        : required
            description : required
            cb          : undefined
        @call
            message :
                message.publish_path
                    project_id  : opts.project_id
                    path        : opts.path
                    description : opts.description
            cb      : (err, resp) =>
                if err
                    opts.cb?(err)
                else if resp.event == 'error'
                    opts.cb?(resp.error)
                else
                    opts.cb?(undefined, resp.result)

    unpublish_path: (opts) =>
        opts = defaults opts,
            project_id  : required
            path        : required
            cb          : undefined
        @call
            message :
                message.unpublish_path
                    project_id  : opts.project_id
                    path        : opts.path
            cb      : (err, resp) =>
                if err
                    opts.cb?(err)
                else if resp.event == 'error'
                    opts.cb?(resp.error)
                else
                    opts.cb?(undefined, resp.result)

    get_public_paths: (opts) =>
        opts = defaults opts,
            project_id : required
            cb         : required
        @call
            message :
                message.get_public_paths
                    project_id  : opts.project_id
            cb      : (err, resp) =>
                if err
                    opts.cb?(err)
                else if resp.event == 'error'
                    opts.cb?(resp.error)
                else
                    opts.cb?(undefined, resp.paths)


    ######################################################################
    # Execute a program in a given project
    ######################################################################
    exec: (opts) ->
        opts = defaults opts,
            project_id      : required
            path            : ''
            command         : required
            args            : []
            timeout         : 30
            network_timeout : undefined
            max_output      : undefined
            bash            : false
            err_on_exit     : true
            cb              : required   # cb(err, {stdout:..., stderr:..., exit_code:...}).

        if not opts.network_timeout?
            opts.network_timeout = opts.timeout * 1.5

        #console.log("Executing -- #{opts.command}, #{misc.to_json(opts.args)} in '#{opts.path}'")
        @call
            message : message.project_exec
                project_id  : opts.project_id
                path        : opts.path
                command     : opts.command
                args        : opts.args
                timeout     : opts.timeout
                max_output  : opts.max_output
                bash        : opts.bash
                err_on_exit : opts.err_on_exit
            timeout : opts.network_timeout
            cb      : (err, mesg) ->
                #console.log("Executing #{opts.command}, #{misc.to_json(opts.args)} -- got back: #{err}, #{misc.to_json(mesg)}")
                if err
                    opts.cb(err, mesg)
                else if mesg.event == 'error'
                    opts.cb(mesg.error)
                else
                    opts.cb(false, {stdout:mesg.stdout, stderr:mesg.stderr, exit_code:mesg.exit_code})

    makedirs: (opts) =>
        opts = defaults opts,
            project_id : required
            path       : required
            cb         : undefined      # (err)
        @exec
            project_id : opts.project_id
            command    : 'mkdir'
            args       : ['-p', opts.path]
            cb         : opts.cb

    remove_file_from_project: (opts) =>
        opts = defaults opts,
            project_id : required
            path       : required
            cb         : undefined      # (err)
        @exec
            project_id : opts.project_id
            command    : 'rm'
            args       : ['-rf', opts.path]
            cb         : opts.cb

    # find directories and subdirectories matching a given query
    find_directories: (opts) =>
        opts = defaults opts,
            project_id     : required
            query          : '*'   # see the -iname option to the UNIX find command.
            path           : '.'
            include_hidden : false
            cb             : required      # cb(err, object describing result (see code below))

        @exec
            project_id : opts.project_id
            command    : "find"
            timeout    : 15
            args       : [opts.path, '-xdev', '-type', 'd', '-iname', opts.query]
            bash       : false
            cb         : (err, result) =>
                if err
                    opts.cb?(err); return
                if result.event == 'error'
                    opts.cb?(result.error); return
                n = opts.path.length + 1
                v = result.stdout.split('\n')
                if not opts.include_hidden
                    v = (x for x in v when x.indexOf('/.') == -1)
                v = (x.slice(n) for x in v when x.length > n)
                ans =
                    query       : opts.query
                    path        : opts.path
                    project_id  : opts.project_id
                    directories : v
                opts.cb?(undefined, ans)

    #################################################
    # Activity
    #################################################
    get_all_activity: (opts) =>
        opts = defaults opts,
            cb : required
        @call
            message : message.get_all_activity()
            cb      : (err, mesg) =>
                if err
                    opts.cb?(err)
                else if mesg.event == 'error'
                    opts.cb?(mesg.error)
                else
                    opts.cb?(undefined, misc.activity_log(mesg.activity_log))

    mark_activity: (opts) =>
        opts = defaults opts,
            events  : required     # [id, id, ...]
            mark    : required     # 'read', 'seen'
            cb      : undefined
        @call
            message : message.mark_activity(events:opts.events, mark:opts.mark)
            cb      : (err, mesg) =>
                if err
                    opts.cb?(err)
                else if mesg.event == 'error'
                    opts.cb?(mesg.error)
                else
                    opts.cb?()

    #################################################
    # Search / user info
    #################################################

    user_search: (opts) =>
        opts = defaults opts,
            query    : required
            query_id : -1     # So we can check that it matches the most recent query
            limit    : 20
            timeout  : DEFAULT_TIMEOUT
            cb       : required

        @call
            message : message.user_search(query:opts.query, limit:opts.limit)
            timeout : opts.timeout
            cb      : (err, resp) =>
                if err
                    opts.cb(err)
                else
                    opts.cb(false, resp.results, opts.query_id)

    project_users: (opts) =>
        opts = defaults opts,
            project_id : required
            cb         : required   # cb(err, list_of_users) -- see message.coffee for format of entries
        @call
            message : message.get_project_users(project_id:opts.project_id)
            cb      : (err, resp) =>
                if resp?.event == 'error'
                    err = resp.error
                if err
                    opts.cb(err)
                else
                    opts.cb(false, resp.users)

    project_invite_collaborator: (opts) =>
        opts = defaults opts,
            project_id : required
            account_id : required
            cb         : (err) =>
        @call
            message : message.invite_collaborator(project_id:opts.project_id, account_id:opts.account_id)
            cb      : (err, result) =>
                if err
                    opts.cb(err)
                else if result.event == 'error'
                    opts.cb(result.error)
                else
                    opts.cb(false, result)

    project_remove_collaborator: (opts) =>
        opts = defaults opts,
            project_id : required
            account_id : required
            cb         : (err) =>

        @call
            message : message.remove_collaborator(project_id:opts.project_id, account_id:opts.account_id)
            cb      : (err, result) =>
                if err
                    opts.cb(err)
                else if result.event == 'error'
                    opts.cb(result.error)
                else
                    opts.cb(undefined, result)

    ############################################
    # Bulk information about several projects or accounts
    # (may be used by activity notifications, chat, etc.)
    # NOTE:
    #    When get_projects is called (which happens regularly), any info about
    #    project titles or "account_id --> name" mappings gets updated. So
    #    usually get_project_titles and get_usernames doesn't even have
    #    to make a call to the server.   A case where it would is when rendering
    #    the notifications and the project list hasn't been returned.  Also,
    #    at some point, project list will probably just return the most recent
    #    projects or partial info about them.
    #############################################

    get_project_titles: (opts) ->
        opts = defaults opts,
            project_ids : required
            use_cache   : true
            cb          : required     # cb(err, map from project_id to string (project title))
        titles = {}
        for project_id in opts.project_ids
            titles[project_id] = false
        if opts.use_cache
            for project_id, done of titles
                if not done and @_project_title_cache[project_id]?
                    titles[project_id] = @_project_title_cache[project_id]
        project_ids = (project_id for project_id,done of titles when not done)
        if project_ids.length == 0
            opts.cb(undefined, titles)
        else
            @call
                message : message.get_project_titles(project_ids : project_ids)
                cb      : (err, resp) =>
                    if err
                        opts.cb(err)
                    else if resp.event == 'error'
                        opts.cb(resp.error)
                    else
                        for project_id, title of resp.titles
                            titles[project_id] = title
                            @_project_title_cache[project_id] = title   # TODO: we could expire this cache...
                        opts.cb(undefined, titles)


    get_usernames: (opts) ->
        opts = defaults opts,
            account_ids : required
            use_cache   : true
            cb          : required     # cb(err, map from account_id to {first_name:?, last_name:?})
        usernames = {}
        for account_id in opts.account_ids
            usernames[account_id] = false
        if opts.use_cache
            for account_id, done of usernames
                if not done and @_usernames_cache[account_id]?
                    usernames[account_id] = @_usernames_cache[account_id]
        account_ids = (account_id for account_id,done of usernames when not done)
        if account_ids.length == 0
            opts.cb(undefined, usernames)
        else
            @call
                message : message.get_usernames(account_ids : account_ids)
                cb      : (err, resp) =>
                    if err
                        opts.cb(err)
                    else if resp.event == 'error'
                        opts.cb(resp.error)
                    else
                        for account_id, username of resp.usernames
                            usernames[account_id] = username
                            @_usernames_cache[account_id] = username   # TODO: we could expire this cache...
                        opts.cb(undefined, usernames)

    #################################################
    # File Management
    #################################################
    project_directory_listing: (opts) =>
        opts = defaults opts,
            project_id : required
            path       : '.'
            time       : false
            start      : 0
            limit      : 999999999 # effectively unlimited by default -- get what you can in the time you have...
            timeout    : 60
            hidden     : false
            cb         : required

        if opts.path.slice(0,9) == ".snapshot" and (opts.path.length == 9 or opts.path[9] == '/')
            opts.path = opts.path.slice(9)
            if opts.path.length > 0 and opts.path[0] == '/'
                opts.path = opts.path.slice(1)  # delete leading slash
            delete opts.time
            @project_snap_listing(opts)
            return

        args = []
        if opts.time
            args.push("--time")
        if opts.hidden
            args.push("--hidden")
        args.push("--limit")
        args.push(opts.limit)
        args.push("--start")
        args.push(opts.start)
        if opts.path == ""
            opts.path = "."
        args.push(opts.path)

        @exec
            project_id : opts.project_id
            command    : gitls
            args       : args
            timeout    : opts.timeout
            cb         : (err, output) ->
                if err
                    opts.cb(err)
                else if output.exit_code
                    opts.cb(output.stderr)
                else
                    v = misc.from_json(output.stdout)
                    if opts.path == '.' and opts.hidden
                        v.files.unshift({name:'.snapshot', isdir:true})
                    opts.cb(err, v)

    project_status: (opts) =>
        opts = defaults opts,
            project_id : required
            cb         : required     # cb(err, utc_seconds_epoch)
        @call
            message:
                message.project_status
                    project_id : opts.project_id
            cb : (err, resp) ->
                if err
                    opts.cb(err)
                else if resp.event == 'error'
                    opts.cb(resp.error)
                else
                    opts.cb(false, resp.status)

    project_get_state: (opts) =>
        opts = defaults opts,
            project_id : required
            cb         : required     # cb(err, utc_seconds_epoch)
        @call
            message:
                message.project_get_state
                    project_id : opts.project_id
            cb : (err, resp) ->
                if err
                    opts.cb(err)
                else if resp.event == 'error'
                    opts.cb(resp.error)
                else
                    opts.cb(false, resp.state)

    #################################################
    # Project Server Control
    #################################################
    restart_project_server: (opts) =>
        opts = defaults opts,
            project_id : required
            cb         : undefined
        @call
            message : message.project_restart(project_id:opts.project_id)
            timeout : 30    # should take about 5 seconds, but maybe network is slow (?)
            cb      : opts.cb

    close_project: (opts) =>
        opts = defaults opts,
            project_id : required
            cb         : required    # will keep retrying until it succeeds at which point opts.cb().

        @call
            message : message.close_project(project_id:opts.project_id)
            timeout : 120
            cb      : opts.cb

    #################################################
    # Some UI state
    #################################################
    in_fullscreen_mode: (state) =>
        if state?
            @_fullscreen_mode = state
        return $(window).width() <= 767 or @_fullscreen_mode

    #################################################
    # Print file to pdf
    # The printed version of the file will be created in the same directory
    # as path, but with extension replaced by ".pdf".
    #################################################
    print_to_pdf: (opts) =>
        opts = defaults opts,
            project_id  : required
            path        : required
            timeout     : 90          # client timeout -- some things can take a long time to print!
            options     : undefined   # optional options that get passed to the specific backend for this file type
            cb          : undefined   # cp(err, relative path in project to printed file)
        opts.options.timeout = opts.timeout  # timeout on backend
        @call_local_hub
            project_id : opts.project_id
            message    : message.print_to_pdf
                path    : opts.path
                options : opts.options
            timeout    : opts.timeout
            cb         : (err, resp) =>
                console.log("print_to_pdf returned resp = ", resp)
                if err
                    opts.cb?(err)
                else if resp.event == 'error'
                    if resp.error?
                        opts.cb?(resp.error)
                    else
                        opts.cb?('error')
                else
                    opts.cb?(undefined, resp.path)


    #################################################
    # Bad situation error loging
    #################################################
    log_error: (error) =>
        @call(message : message.log_client_error(error:error))


    ######################################################################
    # stripe payments api
    ######################################################################
    # gets custormer info (if any) and stripe public api key
    # for this user, if they are logged in
    stripe_get_customer: (opts) =>
        opts = defaults opts,
            cb    : required
        @call
            message     : message.stripe_get_customer()
            error_event : true
            cb          : (err, mesg) =>
                if err
                    opts.cb(err)
                else
                    resp =
                        stripe_publishable_key : mesg.stripe_publishable_key
                        customer               : mesg.customer
                    opts.cb(undefined, resp)

    stripe_create_source: (opts) =>
        opts = defaults opts,
            token : required
            cb    : required
        @call
            message     : message.stripe_create_source(token: opts.token)
            error_event : true
            cb          : opts.cb

    stripe_delete_source: (opts) =>
        opts = defaults opts,
            card_id : required
            cb    : required
        @call
            message     : message.stripe_delete_source(card_id: opts.card_id)
            error_event : true
            cb          : opts.cb

    stripe_update_source: (opts) =>
        opts = defaults opts,
            card_id : required
            info    : required
            cb      : required
        @call
            message     : message.stripe_update_source(card_id: opts.card_id, info:opts.info)
            error_event : true
            cb          : opts.cb

    stripe_set_default_source: (opts) =>
        opts = defaults opts,
            card_id : required
            cb    : required
        @call
            message     : message.stripe_set_default_source(card_id: opts.card_id)
            error_event : true
            cb          : opts.cb


    # gets list of past stripe charges for this account.
    stripe_get_charges: (opts) =>
        opts = defaults opts,
            limit          : undefined    # between 1 and 100 (default: 10)
            ending_before  : undefined    # see https://stripe.com/docs/api/node#list_charges
            starting_after : undefined
            cb             : required
        @call
            message     :
                message.stripe_get_charges
                    limit          : opts.limit
                    ending_before  : opts.ending_before
                    starting_after : opts.starting_after
            error_event : true
            cb          : (err, mesg) =>
                if err
                    opts.cb(err)
                else
                    opts.cb(undefined, mesg.charges)

    # gets stripe plans that could be subscribed to.
    stripe_get_plans: (opts) =>
        opts = defaults opts,
            cb    : required
        @call
            message     : message.stripe_get_plans()
            error_event : true
            cb          : (err, mesg) =>
                if err
                    opts.cb(err)
                else
                    opts.cb(undefined, mesg.plans)

    stripe_create_subscription: (opts) =>
        opts = defaults opts,
            plan     : required
            quantity : 1  # must be >= number of projects
            coupon   : undefined
            projects : undefined  # ids of projects that subscription applies to
            cb       : required
        @call
            message : message.stripe_create_subscription
                plan     : opts.plan
                quantity : opts.quantity
                coupon   : opts.coupon
                projects : opts.projects
            error_event : true
            cb          : opts.cb

    stripe_cancel_subscription: (opts) =>
        opts = defaults opts,
            subscription_id : required
            at_period_end   : false
            cb              : required
        @call
            message : message.stripe_cancel_subscription
                subscription_id : opts.subscription_id
                at_period_end   : opts.at_period_end
            error_event : true
            cb          : opts.cb

    stripe_update_subscription: (opts) =>
        opts = defaults opts,
            subscription_id : required
            quantity : undefined  # if given, must be >= number of projects
            coupon   : undefined
            projects : undefined  # ids of projects that subscription applies to
            plan     : undefined
            cb       : required
        @call
            message : message.stripe_update_subscription
                subscription_id : opts.subscription_id
                quantity : opts.quantity
                coupon   : opts.coupon
                projects : opts.projects
                plan     : opts.plan
            error_event : true
            cb          : opts.cb

    # gets list of past stripe charges for this account.
    stripe_get_subscriptions: (opts) =>
        opts = defaults opts,
            limit          : undefined    # between 1 and 100 (default: 10)
            ending_before  : undefined    # see https://stripe.com/docs/api/node#list_subscriptions
            starting_after : undefined
            cb             : required
        @call
            message     :
                message.stripe_get_subscriptions
                    limit          : opts.limit
                    ending_before  : opts.ending_before
                    starting_after : opts.starting_after
            error_event : true
            cb          : (err, mesg) =>
                if err
                    opts.cb(err)
                else
                    opts.cb(undefined, mesg.subscriptions)

    # gets list of invoices for this account.
    stripe_get_invoices: (opts) =>
        opts = defaults opts,
            limit          : 10           # between 1 and 100 (default: 10)
            ending_before  : undefined    # see https://stripe.com/docs/api/node#list_charges
            starting_after : undefined
            cb             : required
        @call
            message     :
                message.stripe_get_invoices
                    limit          : opts.limit
                    ending_before  : opts.ending_before
                    starting_after : opts.starting_after
            error_event : true
            cb          : (err, mesg) =>
                if err
                    opts.cb(err)
                else
                    opts.cb(undefined, mesg.invoices)

    stripe_admin_create_invoice_item: (opts) =>
        opts = defaults opts,
            account_id    : undefined    # one of account_id or email_address must be given
            email_address : undefined
            amount        : required     # in US dollars
            description   : required
            cb            : required
        @call
            message : message.stripe_admin_create_invoice_item
                account_id    : opts.account_id
                email_address : opts.email_address
                amount        : opts.amount
                description   : opts.description
            error_event : true
            cb          : opts.cb

    # Queries directly to the database (sort of like Facebook's GraphQL)

    projects: (opts) =>
        opts = defaults opts,
            cb : required
        @query
            query :
                projects : [{project_id:null, title:null, description:null, last_edited:null, users:null}]
            changes : true
            cb : opts.cb

    changefeed: (opts) =>
        keys = misc.keys(opts)
        if keys.length != 1
            throw "must specify exactly one table"
        table = keys[0]
        x = {}
        if not misc.is_array(opts[table])
            x[table] = [opts[table]]
        else
            x[table] = opts[table]
        return @query(query:x, changes: true)

    sync_table: (opts) =>
        if typeof(opts) == 'string'
            # name of a table -- get all fields
            v = misc.copy(rethink_shared.SCHEMA[opts].user_query.get.fields)
            for k,_ of v
                v[k] = null
            x = {"#{opts}": [v]}
        else
            keys = misc.keys(opts)
            if keys.length != 1
                throw "must specify exactly one table"
            table = keys[0]
            x = {}
            if not misc.is_array(opts[table])
                x = {"#{table}": [opts[table]]}
            else
                x = {"#{table}": opts[table]}
        return new SyncTable(x, @)

    query: (opts) =>
        opts = defaults opts,
            query   : required
            changes : undefined
            options : undefined
            cb      : required
        mesg = message.query
            query          : opts.query
            options        : opts.options
            changes        : opts.changes
            multi_response : opts.changes
        @call
            message     : mesg
            error_event : true
            cb          : opts.cb

    query_cancel: (opts) =>
        opts = defaults opts,
            id : required
            cb : undefined
        @call  # getting a message back with this id cancels listening
            message     : message.query_cancel(id:opts.id)
            error_event : true
            timeout     : 30
            cb          : opts.cb

    query_get_changefeed_ids: (opts) =>
        opts = defaults opts,
            cb : required
        @call  # getting a message back with this id cancels listening
            message     : message.query_get_changefeed_ids()
            error_event : true
            timeout     : 30
            cb          : (err, resp) =>
                if err
                    opts.cb(err)
                else
                    opts.cb(undefined, resp.changefeed_ids)

###

SYNCHRONIZED TABLE -- defined by an object query

    - Do a query against a RethinkDB table using our object query description.
    - Synchronization with the backend database is done automatically.

   Methods:
      - constructor(query): query = the name of a table (or a more complicated object)

      - set(map):  Set the given keys of map to their values; one key must be
                   the primary key for the table.

      - get():     Current value of the query, as an immutable.js Map from
                   the primary key to the records, which are also immutable.js Maps.
      - get(key):  The record with given key, as an immutable Map.
      - get(keys): Immutable Map from given keys to the corresponding records.
      - get_one(): Returns one record as an immutable Map (useful if there
                   is only one record)

      - close():   Frees up resources, stops syncing, don't use object further

   Events:
      - 'change', [array of primary keys] : fired any time the value of the query result
                 changes, *including* if changed by calling set on this object.
###

immutable = require('immutable')

class SyncTable extends EventEmitter
    constructor: (@_query, @_client) ->
        @_init_query()

        # The value of this query locally.
        @_value_local = undefined

        # Our best guess as to the value of this query on the server,
        # according to queries and updates the server pushes to us.
        @_value_server = undefined

        # The changefeed id, when set by doing a change-feed aware query.
        @_id = undefined

        # Reconnect on connect.
        @_client.on('connected', @_reconnect)

        # Connect to the server the first time.
        @_reconnect()

    get: (arg) =>
        if arg?
            if misc.is_array(arg)
                x = {}
                for k in arg
                    x[k] = @_value_local.get(k)
                return immutable.fromJS(x)
            else
                return @_value_local.get(arg)
        else
            return @_value_local

    get_one: =>
        return @_value_local?.toSeq().first()

    _init_query: =>
        # Check that the query is probably valid, and record the table and schema
        if misc.is_array(@_query)
            throw "must be a single query"
        tables = misc.keys(@_query)
        if misc.len(tables) != 1
            throw "must query only a single table"
        @_table = tables[0]
        if not misc.is_array(@_query[@_table])
            throw "must be a multi-document queries"
        @_schema = rethink_shared.SCHEMA[@_table]
        if not @_schema?
            throw "unknown schema for table #{@_table}"
        @_primary_key = @_schema.primary_key ? "id"
        # TODO: could put in more checks on validity of query here, using schema...
        if not @_query[@_table][0][@_primary_key]?
            # must include primary key in query
            @_query[@_table][0][@_primary_key] = null

        # Determine which fields the user is allowed to set.
        @_set_fields = []
        for field in misc.keys(@_query[@_table][0])
            if @_schema.user_query?.set?.fields?[field]?
                @_set_fields.push(field)

        # Is anonymous access to this table allowed?
        @_anonymous = !!@_schema.anonymous

    _reconnect: (cb) =>
        if @_closed
            throw "object is closed"
        if not @_anonymous and not @_client.is_signed_in()
            #console.log("waiting for sign in before connecting")
            @_client.once 'signed_in', =>
                #console.log("sign in triggered connecting")
                @_reconnect(cb)
            return
        if @_reconnecting?
            @_reconnecting.push(cb)
            return
        @_reconnecting = [cb]
        connect = false
        async.series([
            (cb) =>
                if not @_id?
                    connect = true
                    cb()
                else
                    # TODO: this should be done better via registering in client, which also needs to
                    # *cancel* any old changefeeds we don't care about, e.g., due
                    # to refreshing browser, but are still getting messages about.
                    @_client.query_get_changefeed_ids
                        cb : (err, ids) =>
                            if err or @_id not in ids
                                connect = true
                            cb()
            (cb) =>
                if connect
                    misc.retry_until_success
                        f           : @_run
                        max_tries   : 100  # maybe make more -- this is for testing -- TODO!
                        start_delay : 3000
                        cb          : cb
                else
                    cb()
        ], (err) =>
            if err
                @emit "error", err
            v = @_reconnecting
            delete @_reconnecting
            for cb in v
                cb?(err)
        )

    _run: (cb) =>
        if @_closed
            throw "object is closed"
        first = true
        @_client.query
            query   : @_query
            changes : true
            cb      : (err, resp) =>
                if @_closed
                    throw "object is closed"
                if first
                    # result of doing query
                    first = false
                    if err
                        #console.log("_run: first error ", err)
                        cb?(err)
                    else
                        @_id = resp.id
                        #console.log("query resp = ", resp)
                        @_update_all(resp.query[@_table])
                        cb?()
                else
                    # changefeed
                    if err
                        # TODO: test this by disconnecting backend database
                        #console.log("_run: not first error ", err)
                        @_reconnect()
                    else
                        @_update_change(resp)

    save: (cb) =>
        if @_saving?
            @_saving.push(cb)
            return
        @_saving = [cb]
        # Determine which records have changed and what their new values are.
        changed = {}
        if not @_value_server?
            raise "don't know sever yet"
        if not @_value_local?
            raise "don't know local yet"
        @_value_local.map (new_val, key) =>
            old_val = @_value_server.get(key)
            if not new_val.equals(old_val)
                changed[key] = {new_val:new_val, old_val:old_val}

        # send our changes to the server
        # TODO: should group all queries in one call.
        f = (key, cb) =>
            c = changed[key]
            obj = {"#{@_primary_key}":key}
            for k in @_set_fields
                v = c.new_val.get(k)
                if v?
                    if typeof(v) == 'object'
                        if not v.equals(c.old_val.get(k))
                            obj[k] = v.toJS()
                    else if v != c.old_val.get(k)  # basic type (not immutable js)
                        obj[k] = v
            @_client.query
                query : {"#{@_table}":obj}
                cb    : cb
        async.map misc.keys(changed), f, (err) =>
            v = @_saving; delete @_saving
            for cb in v
                cb?(err)

    # Handle an update of all records from the database.  This happens on
    # initialization, and also if we disconnect and reconnect.
    _update_all: (v) =>
        #console.log("_update_all", v)

        # Restructure the array of records in v as a mapping from the primary key
        # to the corresponding record.
        x = {}
        for y in v
            x[y[@_primary_key]] = y

        # Figure out what to change in our local view of the database query result.
        if not @_value_local? or not @_value_server?
            # Easy case -- nothing has been initialized yet, so just set everything.
            @_value_local = @_value_server = immutable.fromJS(x)
            changed_keys = misc.keys(x)  # of course all keys have been changed.
        else
            # Harder case -- everything has already been initialized.
            changed_keys = []
            # DELETE or CHANGED:
            # First check through each key in our local view of the query
            # and if the value differs from what is in the database, make
            # that change.  (Later we will possibly merge in the change
            # using the last known upstream database state.)
            @_value_local.map (val, key) =>
                if not val.equals(x[key])
                    changed_keys.push(key)
                    if not val.equals(@_value_server.get(key))
                        # TODO: conflict -- unsaved changes would be overwritten!
                        # This is exactly what might happen in the case of loosing network for a while.
                        console.log("TODO: db conflict: conflict -- unsaved changes would be overwritten ", key, val)
                    if not x[key]?
                        # delete the record
                        @_value_local = @_value_local.delete(key)
                    else
                        # set the record to its new server value
                        @_value_local = @_value_local.set(key, immutable.fromJS(x[key]))
            # NEWLY ADDED:
            # Next check through each key in what's on the remote database,
            # and if the corresponding local key isn't defined, set its value.
            # Here we are simply checking for newly added records.
            for key, val of x
                if not @_value_local.get(key)?
                    @_value_local = @_value_local.set(key, immutable.fromJS(val))
                    changed_keys.push(key)

        # It's possibly that nothing changed (e.g., typical case on reconnect!) so we check.
        # If something really did change, we set the server state to what we just got, and
        # also inform listeners of which records changed (by giving keys).
        #console.log("update_all: changed_keys=", changed_keys)
        if changed_keys.length != 0
            @_value_server = immutable.fromJS(x)
            @emit('change', changed_keys)

    _update_change: (change) =>
        #console.log("_update_change", change)
        changed_keys = []
        if change.new_val?
            key = change.new_val[@_primary_key]
            new_val = immutable.fromJS(change.new_val)
            if not new_val.equals(@_value_local.get(key))
                @_value_local = @_value_local.set(key, new_val)
                changed_keys.push(key)
            @_value_server = @_value_server.set(key, new_val)
        if change.old_val? and change.old_val[@_primary_key] != change.new_val?[@_primary_key]
            # Delete a record (TODO: untested)
            key = change.old_val[@_primary_key]
            @_value_local = @_value_local.delete(key)
            @_value_server = @_value_server.delete(key)
            changed_keys.push(key)

        #console.log("update_change: changed_keys=", changed_keys)
        if changed_keys.length > 0
            #console.log("_update_change: change")
            @emit('change', changed_keys)

    set: (obj) =>
        if @_closed
            throw "object is closed"
        if not @_value_local?
            @_value_local = immutable.Map({})
        can_set = rethink_shared.SCHEMA[@_table].user_query.set.fields
        for k, v of obj
            if can_set[k] == undefined
                throw "users may not set {@_table}.#{k}"
        k = obj[@_primary_key]
        if not k?
            k = @_value_local.keySeq().first()
            if not k?
                throw "must specify primary key #{@_primary_key}"
        cur = @_value_local.get(k)
        [obj, changed] = merge_into_immutable_map(obj, cur)
        @_value_local = @_value_local.set(k, obj)
        if changed
            #console.log("set: change")
            @emit('change')
        @save()

    close: =>
        @_closed = true
        @removeAllListeners()
        if @_id?
            @_client.query_cancel(id:@_id)
        delete @_value_local
        delete @_value_server
        @_client.removeListener('connected', @_reconnect)

merge_into_immutable_map = (obj, map) ->
    if not map?
        return [immutable.fromJS(obj), true]
    changed = false
    for k, v of obj
        y = map.get(k)
        if typeof(v) != 'object'
            i = immutable.fromJS(v)
            if (i?.equals? and not i.equals(y)) or (y?.equals? and not y.equals(i)) or i != y
                changed = true
                map = map.set(k, i)
        else
            [s, changed0] = merge_into_immutable_map(v, y)
            if changed0
                changed = true
                map = map.set(k, s)
    return [map, changed]

#################################################
# Other account Management functionality shared between client and server
#################################################

reValidEmail = (() ->
    sQtext = "[^\\x0d\\x22\\x5c\\x80-\\xff]"
    sDtext = "[^\\x0d\\x5b-\\x5d\\x80-\\xff]"
    sAtom = "[^\\x00-\\x20\\x22\\x28\\x29\\x2c\\x2e\\x3a-\\x3c\\x3e\\x40\\x5b-\\x5d\\x7f-\\xff]+"
    sQuotedPair = "\\x5c[\\x00-\\x7f]"
    sDomainLiteral = "\\x5b(" + sDtext + "|" + sQuotedPair + ")*\\x5d"
    sQuotedString = "\\x22(" + sQtext + "|" + sQuotedPair + ")*\\x22"
    sDomain_ref = sAtom
    sSubDomain = "(" + sDomain_ref + "|" + sDomainLiteral + ")"
    sWord = "(" + sAtom + "|" + sQuotedString + ")"
    sDomain = sSubDomain + "(\\x2e" + sSubDomain + ")*"
    sLocalPart = sWord + "(\\x2e" + sWord + ")*"
    sAddrSpec = sLocalPart + "\\x40" + sDomain # complete RFC822 email address spec
    sValidEmail = "^" + sAddrSpec + "$" # as whole string
    return new RegExp(sValidEmail)
)()

exports.is_valid_email_address = (email) ->
    # From http://stackoverflow.com/questions/46155/validate-email-address-in-javascript
    # but converted to Javascript; it's near the middle but claims to be exactly RFC822.
    if reValidEmail.test(email)
        return true
    else
        return false

exports.is_valid_password = (password) ->
    if password.length >= 6 and password.length <= 64
        return [true, '']
    else
        return [false, 'Password must be between 6 and 64 characters in length.']

exports.issues_with_create_account = (mesg) ->
    issues = {}
    if not mesg.agreed_to_terms
        issues.agreed_to_terms = 'Agree to the Salvus Terms of Service.'
    if mesg.first_name == ''
        issues.first_name = 'Enter your name.'
    if not exports.is_valid_email_address(mesg.email_address)
        issues.email_address = 'Email address does not appear to be valid.'
    [valid, reason] = exports.is_valid_password(mesg.password)
    if not valid
        issues.password = reason
    return issues



##########################################################################


htmlparser = require("htmlparser")

# extract plain text from a dom tree object, as produced by htmlparser.
dom_to_text = (dom, divs=false) ->
    result = ''
    for d in dom
        switch d.type
            when 'text'
                result += d.data
            when 'tag'
                switch d.name
                    when 'div','p'
                        divs = true
                        result += '\n'
                    when 'br'
                        if not divs
                            result += '\n'
        if d.children?
            result += dom_to_text(d.children, divs)
    result = result.replace(/&nbsp;/g,' ')
    return result

# html_to_text returns a lossy plain text representation of html,
# which does preserve newlines (unlink wrapped_element.text())
exports.html_to_text = (html) ->
    handler = new htmlparser.DefaultHandler((error, dom) ->)
    (new htmlparser.Parser(handler)).parseComplete(html)
    return dom_to_text(handler.dom)
