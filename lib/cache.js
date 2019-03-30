
const redis = require('redis').createClient({
  host: 'redis-12068.c85.us-east-1-2.ec2.cloud.redislabs.com',
  port: 12068,
  password: process.env.REDIS_PASS
})

redis.on('error', err => { console.error('Redis error', err) })

const mapToAf = {}
const streams = {}

function toJson(str) {
	let data
	try {
		data = JSON.parse(str)
	} catch(e) {
		console.error('Redis parse error', e)
	}
	return data
}

module.exports = {
	map: {
		get: (kitsuId, cb) => {
			if (!kitsuId) cb()
			else {
				if (mapToAf[kitsuId]) cb(mapToAf[kitsuId])
				else
					redis.get('kitsu-af-' + kitsuId, (err, afId) => {
						if (!err && afId) cb(afId)
						else cb()
					})
			}
		},
		set: (kitsuId, data) => {
			if (!mapToAf[kitsuId]) {
				mapToAf[kitsuId] = data
				redis.set('kitsu-af-' + kitsuId, data)
			}
		}
	},
	get: (key, cacheMaxAge, cb) => {

		if (streams[key]) {
			cb({ streams: streams[key], cacheMaxAge })
			return
		}

		redis.get(key, (err, redisRes) => {

			if (!err && redisRes) {
				const redisStreams = toJson(redisRes)
				if (redisStreams) {
					cb({ streams: redisStreams, cacheMaxAge })
					return
				}
			}
			cb()
		})

	},
	set: (key, data) => {
		// cache forever
		streams[key] = data
		redis.set(key, JSON.stringify(data))
	},
	genres: {
		set: data => {
			redis.set('af-genres', JSON.stringify(data))
		},
		get: cb => {
			redis.get('af-genres', (err, redisRes) => {

				if (!err && redisRes) {
					const redisGenres = toJson(redisRes)
					if (redisGenres) {
						cb(redisGenres)
						return
					}
				}
				cb()
			})
		}
	},
	catalog: {
		set: (key, page, data) => {
			if (!key) return
			const redisKey = 'af-catalog-' + key + (page > 1 ? ('-' + page) : '')
			redis.set(redisKey, JSON.stringify(data))
		},
		get: (key, page, cb) => {
			if (!key) {
				cb()
				return
			}
			const redisKey = 'af-catalog-' + key + (page > 1 ? ('-' + page) : '')
			redis.get(redisKey, (err, redisRes) => {

				if (!err && redisRes) {
					const redisCatalog = toJson(redisRes)
					if (redisCatalog) {
						cb(redisCatalog)
						return
					}
				}
				cb()
			})
		}
	}
}
