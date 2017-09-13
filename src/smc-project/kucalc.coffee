###
Some code specific to running a project in the KuCalc environment.
###

fs = require('fs')
async = require('async')

misc      = require('smc-util/misc')
misc_node = require('smc-util-node/misc_node')

# This gets **changed** to true in local_hub.coffee, if a certain
# command line flag is passed in.
exports.IN_KUCALC = false

# static values for monitoring and project information
# uniquely identifies this instance of the local hub
session_id = misc.uuid()
# record when this instance started
start_ts   = (new Date()).getTime()
# status information
current_status = {}

exports.init = (client) ->
    # update project status every 30s
    # TODO: could switch to faster when it's changing and slower when it isn't.
    f = -> update_project_status(client)
    f()
    setInterval(f, 30000)

update_project_status = (client, cb) ->
    dbg = client.dbg("update_status")
    dbg()
    status = undefined
    async.series([
        (cb) ->
            compute_status (err, s) ->
                status = s
                current_status = s
                cb(err)
        (cb) ->
            client.query
                query   :
                    projects : {project_id:client.client_id(), status: status}
                cb      : cb
    ], (err) ->
        cb?(err)
    )

exports.compute_status = compute_status = (cb) ->
    status =
        memory   : {rss: 0}
        disk_MB  : 0
        cpu      : {}
        start_ts : start_ts
    async.parallel([
        (cb) ->
            compute_status_disk(status, cb)
        (cb) ->
            #compute_status_memory(status, cb)
            cgroup_stats(status, cb)
        (cb) ->
            compute_status_tmp(status, cb)
    ], (err) ->
        cb(err, status)
    )

compute_status_disk = (status, cb) ->
    disk_usage "$HOME", (err, x) ->
        status.disk_MB = x
        cb(err)

# NOTE: we use tmpfs for /tmp, so RAM usage is the **sum** of /tmp and what
# processes use.
compute_status_tmp = (status, cb) ->
    disk_usage "/tmp", (err, x) ->
        status.memory.rss += 1000*x
        cb(err)

compute_status_memory = (status, cb) ->
    misc_node.execute_code
        command : "smem -nu | tail -1 | awk '{print $6}'"
        bash    : true
        cb      : (err, out) ->
            if err
                cb(err)
            else
                status.memory.rss += parseInt(out.stdout)
                cb()

# this grabs the memory stats directly from the sysfs cgroup files
# the actual usage is the sum of the rss values plus cache, but we leave cache aside
cgroup_stats = (status, cb) ->
    async.parallel({
        memory : (cb) ->
            fs.readFile '/sys/fs/cgroup/memory/memory.stat', 'utf8', (err, data) ->
                if err
                    cb(err)
                    return
                stats = {}
                for line in data.split('\n')
                    [key, value] = line.split(' ')
                    try
                        stats[key] = parseInt(value)
                cb(null, stats)

        cpu : (cb) ->
            fs.readFile '/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage', 'utf8', (err, data) ->
                if err
                    cb(err)
                    return
                try
                    cb(null, parseFloat(data) / Math.pow(10, 9))
                catch
                    cb(null, 0.0)

    }, (err, res) ->
        kib = 1024 # convert to kibibyte
        status.memory.rss  += (res.memory.total_rss ? 0 + stats.total_rss_huge ? 0) / kib
        status.memory.cache = (res.memory.cache ? 0) / kib
        status.memory.limit = (res.memory.hierarchical_memory_limit ? 0) / kib
        status.cpu.usage    = res.cpu
        cb()
    )


disk_usage = (path, cb) ->
    misc_node.execute_code
        command : "df -BM #{path} | tail -1 | awk '{gsub(\"M\",\"\");print $3}'"
        bash    : true
        cb      : (err, out) ->
            if err
                cb(err)
            else
                cb(undefined, parseInt(out.stdout))


# Every 60s, check if we can reach google's internal network -- in kucalc on GCE, this must be blocked.
# If we recieve some information, exit with status code 99.
exports.init_gce_firewall_test = (logger, interval_ms=60*1000) ->
    return # temporarily disabled
    if not exports.IN_KUCALC
        logger?.warn("not running firewall test -- not in kucalc")
        return
    URI = 'http://metadata.google.internal/computeMetadata/v1/'
    test_firewall = ->
        logger?.log("test_firewall")
        request = require('request')
        request(
            timeout : 3000
            headers :
              'Metadata-Flavor' : 'Google'
            uri: URI
            method: 'GET'
        , (err, res, body) ->
            if err?.code == 'ETIMEDOUT'
                logger?.log('test_firewall: timeout -> no action')
            else
                logger?.warn('test_firewall', res)
                logger?.warn('test_firewall', body)
                if res? or body?
                    logger?.warn('test_firewall: request went through and got a response -> exiting with code 99')
                    process.exit(99)
                else
                    logger?.warn('test_firewall: request went through with no response -> no action')
        )
    test_firewall()
    setInterval(test_firewall, interval_ms)
    return

exports.prometheus_metrics = () ->
    {get_bugs_total} = require('./local_hub')
    labels = "project_id=\"#{project_id}\",session_id=\"#{session_id}\""
    """
    # HELP kucalc_project_bugs_total The total number of caught bugs.
    # TYPE kucalc_project_bugs_total counter
    kucalc_project_bugs_total{#{labels}} #{get_bugs_total()}
    # HELP kucalc_project_start_time when the project/session started
    # TYPE kucalc_project_start_time counter
    kucalc_project_start_time{#{labels}} #{start_ts}
    # HELP kucalc_project_cpu_usage_seconds
    # TYPE kucalc_project_cpu_usage_seconds counter
    kucalc_project_start_time{#{labels}} #{current_status.cpu?.usage ? 0.0}
    # HELP kucalc_project_memory_usage_ki
    # TYPE kucalc_project_memory_usage_ki gauge
    kucalc_project_memory_usage_ki #{current_status.memory?.rss ? 0.0}
    # HELP kucalc_project_memory_limit_ki
    # TYPE kucalc_project_memory_limit_ki gauge
    kucalc_project_memory_limit_ki #{current_status.memory?.limit ? 0.0}
    """

# called inside raw_server
exports.init_health_metrics = (raw_server, project_id) ->
    return if not exports.IN_KUCALC

    # Setup health and metrics (no url base prefix needed)
    raw_server.use '/health', (req, res) ->
        res.setHeader("Content-Type", "text/plain")
        res.setHeader('Cache-Control', 'private, no-cache, must-revalidate')
        res.send('OK')

    # prometheus text format -- https://prometheus.io/docs/instrumenting/exposition_formats/#text-format-details
    raw_server.use '/metrics', (req, res) ->
        res.setHeader("Content-Type", "text/plain; version=0.0.4")
        res.setHeader('Cache-Control', 'private, no-cache, must-revalidate')
        res.send(exports.prometheus_metrics())
