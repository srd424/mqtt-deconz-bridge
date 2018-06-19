const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const repeat = require('repeat')
const bodyParser = require('body-parser')
const health = require('homeautomation-js-lib/health.js')
const request = require('request')

require('homeautomation-js-lib/mqtt_helpers.js')

var deconz_ip = process.env.DECONZ_IP
var deconz_port = process.env.DECONZ_PORT
var deconz_key = process.env.DECONZ_API_KEY

  // Config
var topic_prefix = process.env.TOPIC_PREFIX

if (_.isNil(topic_prefix)) {
    logging.warn('TOPIC_PREFIX not set, not starting')
    process.abort()
}

var mqttOptions = {}

var shouldRetain = process.env.MQTT_RETAIN

if (_.isNil(shouldRetain)) {
    shouldRetain = true
}

if (!_.isNil(shouldRetain)) {
    mqttOptions['retain'] = shouldRetain
}

var connectedEvent = function() {
    health.healthyEvent()
}

var disconnectedEvent = function() {
    health.unhealthyEvent()
}

// Setup MQTT
const client = mqtt.setupClient(connectedEvent, disconnectedEvent)

var isConnected = false
var isConnecting = false

const ReconnectingWebSocket = require('reconnecting-websocket')
const WebSocket = require('ws')
const options = {
  WebSocket: WebSocket
};

const wsURL = 'ws://' + deconz_ip + ':' + deconz_port
const rws = new ReconnectingWebSocket(wsURL, [], options);

rws.addEventListener('open', () => {
  logging.info('Connected to Deconz')
  isConnecting = false
  isConnected = true
});

rws.addEventListener('message', (message) => {
  if (_.isNil(message) || _.isNil(message.data)) {
    logging.error('Received empty message, bailing')
    return
  }
  logging.info('Received string: ' + message.data)
  const json = JSON.parse(message.data)

  handleJSONEvent(json)
})


function tryReconnect() {
  setTimeout(() => {
    if ( isConnecting || isConnected )
      return

    rws.reconnect()
  }, 30000)
}

rws.addEventListener('error', (message) => {
  isConnecting = false
  isConnected = false

  logging.info('Connection error')
  tryReconnect()
})

rws.addEventListener('close', (message) => {
  isConnecting = false
  isConnected = false

  logging.info('Connection closed')
  tryReconnect()
})


function handleJSONEvent(json) {
  if (_.isNil(json)) {
    logging.error('Empty JSON to parse')
    return
  }

  switch (json.e) {
    case 'changed':
      handleChangeEvent(json)
      break;
  }
}

function sensorTypeFromJSON(json) {
  if ( !_.isNil(json.config) )
    return 'config'

  if ( !_.isNil(json.state.humidity) || !_.isNil(json.state.temperature) || !_.isNil(json.state.pressure))
    return 'climate'

  if ( !_.isNil(json.state.lux) )
    return 'motion'

  if ( !_.isNil(json.state.presence) )
    return 'motion'

  if ( !_.isNil(json.state.open) )
    return 'contact'

  return null  
}

function handleChangeEvent(json) {
  if (_.isNil(json)) {
    logging.error('Empty change event')
    return
  }

  logging.info('event: ' + JSON.stringify(json))

  switch (sensorTypeFromJSON(json)) {
    case 'config':
      handleConfigEvent(json)
      break;
    case 'motion':
      handleMotionEvent(json)
      break;
    case 'climate':
      handleClimateEvent(json)
      break;
    case 'contact':
      handleContactEvent(json)
      break;
  }

}

function handleClimateEvent(json) {
  if (_.isNil(json)) {
    logging.error('Empty climate event')
    return
  }

  logging.info('Climate: ' + JSON.stringify(json))

  if (!_.isNil(json.state.temperature)) {
    client.publish(topic_prefix + '/climate/temperature/' + json.id, parseResult('temperature', json.state.temperature), mqttOptions)
  }
  if (!_.isNil(json.state.humidity)) {
    client.publish(topic_prefix + '/climate/humidity/' + json.id, parseResult('humidity', json.state.humidity), mqttOptions)
  }
  if (!_.isNil(json.state.pressure)) {
    client.publish(topic_prefix + '/climate/pressure/' + json.id, parseResult('pressure', json.state.pressure), mqttOptions)
  }
}

function handleMotionEvent(json) {
  if (_.isNil(json)) {
    logging.error('Empty motion event')
    return
  }

  logging.info('Motion: ' + JSON.stringify(json))

  if (!_.isNil(json.state.lux)) {
    client.publish(topic_prefix + '/lux/' + json.id, parseResult('lux', json.state.lux), mqttOptions)
  }
  if (!_.isNil(json.state.dark)) {
    client.publish(topic_prefix + '/dark/' + json.id, parseResult('dark', json.state.dark), mqttOptions)
  }
  if (!_.isNil(json.state.daylight)) {
    client.publish(topic_prefix + '/daylight/' + json.id, parseResult('daylight', json.state.daylight), mqttOptions)
  }
  if (!_.isNil(json.state.lightlevel)) {
    client.publish(topic_prefix + '/lightlevel/' + json.id, parseResult('lightlevel', json.state.lightlevel), mqttOptions)
  }
  if (!_.isNil(json.state.presence)) {
    client.publish(topic_prefix + '/presence/' + json.id, parseResult('presence', json.state.presence), mqttOptions)
  }
}

function handleContactEvent(json) {
  if (_.isNil(json)) {
    logging.error('Empty contact event')
    return
  }

  logging.info('Contact: ' + JSON.stringify(json))

  if (!_.isNil(json.state.open)) {
    client.publish(topic_prefix + '/contact/' + json.id, parseResult('contact', json.state.open), mqttOptions)
  }
}

function parseResult(key, value) {
  if ( _.isNil(value) )
    return "0"
  if ( value == true )
    return "1"
  if ( value == false )
    return "0"


  if ( key == 'temperature' )
    return (value / 100.0).toFixed(2).toString()

  if ( key == 'humidity' )
    return (value / 100.0).toFixed(2).toString()

  return value.toString()
}

function handleConfigEvent(json) {
  if (_.isNil(json) || _.isNil(json.config)) {
    logging.error('Empty config event')
    return
  }
  
  logging.info('Config: ' + JSON.stringify(json))

  if (!_.isNil(json.config.battery)) {
    client.publish(topic_prefix + '/battery/' + json.id, parseResult('battery', json.config.battery), mqttOptions)
  }
  if (!_.isNil(json.config.reachable)) {
    client.publish(topic_prefix + '/reachable/' + json.id, parseResult('reachable', json.config.reachable), mqttOptions)
  }

  if (!_.isNil(json.config.temperature)) {
    client.publish(topic_prefix + '/temperature/' + json.id, parseResult('temperature', json.config.temperature), mqttOptions)
  }

}