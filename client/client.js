module.exports = function (
	logger,
	net,
	inherits,
	EventEmitter,
	ReadableStream,
	Message,
	Receiver,
	FetchRequest,
	ProduceRequest,
	OffsetsRequest
) {
	function Client(id, options) {
		this.connection = net.connect(options)
		this.connection.on(
			'connect',
			function () {
				logger.info('client connect')
				this.readableSteam = new ReadableStream()
				this.readableSteam.wrap(this.connection)
				this.receiver = new Receiver(this.readableSteam)
				this.ready = true
				this.emit('connect')
			}.bind(this)
		)
		this.connection.on(
			'end',
			function () {
				logger.info('client end')
				this.ready = false
				this.emit('end')
				this.connection = null
			}.bind(this)
		)
		this.connection.on(
			'drain',
			function () {
				if (!this.ready) { //TODO: why is connection.drain so frequent?
					this.ready = true
					this.emit('ready')
				}
			}.bind(this)
		)
		this.connection.on(
			'error',
			function (err) {
				//logger.info('client error', err)
			}
		)
		this.connection.on(
			'close',
			function (hadError) {
				logger.info('client closed with error:', hadError)
				this.emit('end')
			}.bind(this)
		)
		this.id = id
		this.ready = false
		this.readableSteam = null
		this.receiver = null
		EventEmitter.call(this)
	}
	inherits(Client, EventEmitter)

	Client.prototype.drain = function (cb) {
		logger.info('draining', this.id)
		this.receiver.close(
			function () {
				logger.info('drained', this.id)
				// XXX is reopening correct here?
				this.receiver.open()
				cb()
			}.bind(this)
		)
	}

	Client.prototype._send = function (request, cb) {
		request.serialize(
			this.connection,
			afterSend.bind(this, cb, request)
		)
		return this.ready
	}

	function afterSend(cb, request, err, written) {
		if (err) {
			this.ready = false
			return cb(err)
		}
		if (!written) {
			this.ready = false
		}
		this.receiver.push(request, cb)
	}

	// cb: function (err, length, messages) {}
	Client.prototype.fetch = function (name, partition, maxSize, cb) {
		logger.info(
			'fetching', name,
			'broker', this.id,
			'partition', partition.id
		)
		return this._send(
			new FetchRequest(
				name,
				partition.offset,
				partition.id,
				maxSize
			),
			cb
		)
	}

	// topic: a Topic object
	// messages: array of: string, Buffer, Message
	// partition: number
	Client.prototype.write = function (topic, messages, partitionId, cb) {
		logger.info(
			'publishing', topic.name,
			'messages', messages.length,
			'broker', this.id,
			'partition', partitionId
		)
		return this._send(
			new ProduceRequest(
				topic.name,
				messages.map(Message.create),
				partitionId,
				topic.compression,
				topic.maxMessageSize
			),
			cb
		)
	}

	Client.prototype.offsets = function (time, maxCount, cb) {
		logger.info(
			'offsets', time,
			'broker', this.id
		)
		return this._send(new OffsetsRequest(time, maxCount), cb)
	}

	Client.compression = Message.compression

	return Client
}
