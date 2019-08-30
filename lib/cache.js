
const persist = require('internal').persist

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
					cb(persist.getItem('kitsu-af-' + kitsuId))
			}
		},
		set: (kitsuId, data) => {
			if (!mapToAf[kitsuId]) {
				mapToAf[kitsuId] = data
				persist.setItem('kitsu-af-' + kitsuId, data)
			}
		}
	},
	get: (key, cacheMaxAge, cb) => {

		if (streams[key]) {
			cb({ streams: streams[key], cacheMaxAge })
			return
		}

		cb({ streams: persist.getItem(key), cacheMaxAge })

	},
	set: (key, data) => {
		// cache forever
		streams[key] = data
		persist.setItem(key, data)
	},
	genres: {
		set: data => {
			persist.setItem('af-genres', data)
		},
		get: cb => {
			cb(persist.getItem('af-genres'))
		}
	},
	catalog: {
		set: (key, page, data) => {
			if (!key) return
			const redisKey = 'af-catalog-' + key + (page > 1 ? ('-' + page) : '')
			persist.setItem(redisKey, data)
		},
		get: (key, page, cb) => {
			if (!key) {
				cb()
				return
			}
			const redisKey = 'af-catalog-' + key + (page > 1 ? ('-' + page) : '')
			cb(persist.getItem(redisKey))
		}
	}
}
