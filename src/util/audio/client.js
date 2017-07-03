const util = require('./util')
const {Stream} = require('stream')
const {EventEmitter} = require('events')
const {BufferReadStream} = require('streamers')
const {BinaryStream} = require('./stream')

function BinaryClient(socket, options) {
  if (!(this instanceof BinaryClient)) return new BinaryClient(socket, options);

  EventEmitter.call(this);

  var self = this;

  this._options = util.extend({
    chunkSize: 40960
  }, options);

  this.streams = {};

  this._nextId = 0;
  this._socket = socket

  this._socket.binaryType = 'arraybuffer';

  this._socket.addEventListener('open', function () {
    self.emit('open');
  });
  // if node
  this._socket.addEventListener('drain', function () {
    var ids = Object.keys(self.streams);
    for (var i = 0, ii = ids.length; i < ii; i++) {
      self.streams[ids[i]]._onDrain();
    }
  });
  // end node
  this._socket.addEventListener('error', function (error) {
    var ids = Object.keys(self.streams);
    for (var i = 0, ii = ids.length; i < ii; i++) {
      self.streams[ids[i]]._onError(error);
    }
    self.emit('error', error);
  });
  this._socket.addEventListener('close', function (code, message) {
    var ids = Object.keys(self.streams);
    for (var i = 0, ii = ids.length; i < ii; i++) {
      self.streams[ids[i]]._onClose();
    }
    self.emit('close', code, message);
  });
  this._socket.addEventListener('message', function (data, flags) {
    util.setZeroTimeout(function () {

      // Message format
      // [type, payload, bonus ]
      //
      // Reserved
      // [ 0  , X , X ]
      //
      //
      // New stream
      // [ 1  , Meta , new streamId ]
      //
      //
      // Data
      // [ 2  , Data , streamId ]
      //
      //
      // Pause
      // [ 3  , null , streamId ]
      //
      //
      // Resume
      // [ 4  , null , streamId ]
      //
      //
      // End
      // [ 5  , null , streamId ]
      //
      //
      // Close
      // [ 6  , null , streamId ]
      //

      data = data.data;
      const pt = Object.getPrototypeOf(data)
      if (pt != ArrayBuffer.prototype && pt != Blob.prototype) {
        return
      }
      try {
        data = util.unpack(data);
      } catch (ex) {
        console.debug(ex)
        return
      }
      if (!(data instanceof Array))
        return self.emit('error', new Error('Received non-array message'));
      if (data.length != 3)
        return self.emit('error', new Error('Received message with wrong part count: ' + data.length));
      if ('number' != typeof data[0])
        return self.emit('error', new Error('Received message with non-number type: ' + data[0]));

      switch (data[0]) {
        case 0:
          // Reserved
          break;
        case 1:
          var meta = data[1];
          var streamId = data[2];
          var binaryStream = self._receiveStream(streamId);
          self.emit('stream', binaryStream, meta);
          console.debug('>>> ' + streamId + ' receiving new stream')
          break;
        case 2:
          var payload = data[1];
          var streamId = data[2];
          var binaryStream = self.streams[streamId];
          if (binaryStream) {
            binaryStream._onData(payload);
            console.debug('[+] ' + streamId + ' receiving data');
          } else {
            self.emit('error', new Error('Received `data` message for unknown stream: ' + streamId));
          }
          break;
        case 3:
          var streamId = data[2];
          var binaryStream = self.streams[streamId];
          if (binaryStream) {
            binaryStream._onPause();
            console.debug('||| ' + streamId + ' paused');
          } else {
            self.emit('error', new Error('Received `pause` message for unknown stream: ' + streamId));
          }
          break;
        case 4:
          var streamId = data[2];
          var binaryStream = self.streams[streamId];
          if (binaryStream) {
            binaryStream._onResume();
            console.debug(' >>' + streamId + ' resumed')
          } else {
            self.emit('error', new Error('Received `resume` message for unknown stream: ' + streamId));
          }
          break;
        case 5:
          var streamId = data[2];
          var binaryStream = self.streams[streamId];
          if (binaryStream) {
            binaryStream._onEnd();
            console.debug('[-] ' + streamId + ' ended');
          } else {
            self.emit('error', new Error('Received `end` message for unknown stream: ' + streamId));
          }
          break;
        case 6:
          var streamId = data[2];
          var binaryStream = self.streams[streamId];
          if (binaryStream) {
            binaryStream._onClose();
            console.debug('[x] ' + streamId + ' closed');
          } else {
            self.emit('error', new Error('Received `close` message for unknown stream: ' + streamId));
          }
          break;
        default:
          self.emit('error', new Error('Unrecognized message type received: ' + data[0]));
      }
    });
  });
}

util.inherits(BinaryClient, EventEmitter);

BinaryClient.prototype.send = function (data, meta) {
  var stream = this.createStream(meta);
  if (data instanceof Stream) {
    data.pipe(stream);
  } else if (util.isNode === true) {
    if (Buffer.isBuffer(data)) {
      (new BufferReadStream(data, {chunkSize: this._options.chunkSize})).pipe(stream);
    } else {
      stream.write(data);
    }
  } else if (util.isNode !== true) {
    if (data.constructor == Blob || data.constructor == File) {
      (new BlobReadStream(data, {chunkSize: this._options.chunkSize})).pipe(stream);
    } else if (data.constructor == ArrayBuffer) {
      var blob;
      if (binaryFeatures.useArrayBufferView) {
        data = new Uint8Array(data);
      }
      if (binaryFeatures.useBlobBuilder) {
        var builder = new BlobBuilder();
        builder.append(data);
        blob = builder.getBlob()
      } else {
        blob = new Blob([data]);
      }
      (new BlobReadStream(blob, {chunkSize: this._options.chunkSize})).pipe(stream);
    } else if (typeof data === 'object' && 'BYTES_PER_ELEMENT' in data) {
      var blob;
      if (!binaryFeatures.useArrayBufferView) {
        // Warn
        data = data.buffer;
      }
      if (binaryFeatures.useBlobBuilder) {
        var builder = new BlobBuilder();
        builder.append(data);
        blob = builder.getBlob()
      } else {
        blob = new Blob([data]);
      }
      (new BlobReadStream(blob, {chunkSize: this._options.chunkSize})).pipe(stream);
    } else {
      stream.write(data);
    }
  }
  return stream;
};

BinaryClient.prototype._receiveStream = function (streamId) {
  var self = this;
  var binaryStream = new BinaryStream(this._socket, streamId, false);
  binaryStream.on('close', function () {
    delete self.streams[streamId];
  });
  this.streams[streamId] = binaryStream;
  return binaryStream;
};

BinaryClient.prototype.createStream = function (meta = {}) {
  if (this._socket.readyState !== WebSocket.OPEN) {
    throw new Error('Client is not yet connected or has closed');
    return;
  }
  var self = this;
  var streamId = this._nextId;
  this._nextId += 2;
  var binaryStream = new BinaryStream(this._socket, streamId, true, meta);
  binaryStream.on('close', function () {
    delete self.streams[streamId];
  });
  this.streams[streamId] = binaryStream;
  return binaryStream;
};

BinaryClient.prototype.close = BinaryClient.prototype.destroy = function () {
  this._socket.close();
};

exports.BinaryClient = BinaryClient;