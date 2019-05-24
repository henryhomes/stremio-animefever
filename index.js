const needle = require('needle')
const async = require('async')
const pUrl = require('url').parse
const m3u = require('m3u8-parsed')
const db = require('./lib/cache')

const package = require('./package')

const manifest = {
    id: 'org.animefever.anime',
    version: package.version,
    logo: 'https://www.googleapis.com/download/storage/v1/b/graphicker/o/img%2Fworks%2F5%2F4961%2F875b56ea41f99c9535aa59cf5f346fd8.png?generation=1482729411428000&alt=media',
    name: 'Anime from AnimeFever',
    description: 'Anime from AnimeFever',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series', 'movie'],
    idPrefixes: ['kitsu:'],
    catalogs: [
      {
        type: 'series',
        id: 'animefever-search',
        name: 'AnimeFever',
        extra: [
          {
            name: 'search',
            isRequired: true
          }
        ]
      }, {
        type: 'series',
        id: 'animefever-list',
        name: 'AnimeFever',
        extra: [ { name: 'genre' } ]
      }
    ]
}

const { addonBuilder }  = require('stremio-addon-sdk')

const addon = new addonBuilder(manifest)

const endpoint = 'https://www.animefever.tv/api/anime/'

const headers = {
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'http://animefever.tv',
  'Referer': 'http://animefever.tv/anime',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36',
}

const mapToKitsu = {}

const cache = {
  catalog: {}
}

function toMeta(id, obj) {
  return {
    id,
    name: obj.name,
    description: obj.description,
    poster: (obj.poster || {}).path || null,
    genres: obj.genres.map(genre => { return genre.name }),
    type: 'series'
  }
}

addon.defineCatalogHandler(args => {
  return new Promise((resolve, reject) => {

    const page = 1

    let url = endpoint + 'filter?hasVideos=true&page=' + page + '&search='

    if (args.extra.search)
      url += encodeURIComponent(args.extra.search)

    if (args.extra.genre)
      genres.some(genre => {
        if (genre.name == args.extra.genre) {
          url += '&genres[]=' + genre.id
          return true
        }
      })

    if (cache.catalog[url]) {
      resolve({ metas: cache.catalog[url], cacheMaxAge: 172800 })
      return
    }

    const redisKey = args.extra.search ? null : (args.extra.genre || 'default')

    db.catalog.get(redisKey, page, redisMetas => {

      if (redisMetas)
        resolve({ metas: redisMetas, cacheMaxAge: 86400 })

      needle.get(url, { headers }, (err, resp, body) => {
        const series = (body || {}).data || []
        const metas = []
        if (series.length) {
          const queue = async.queue((task, cb) => {
            if (mapToKitsu[task.id]) {
              metas.push(toMeta(mapToKitsu[task.id], task))
              cb()
              return
            }
            const type = task.type == 'Movie' ? 'movie' : 'series'
            needle.get(kitsuEndpoint + '/catalog/' + type + '/kitsu-search-' + type + '/search=' + encodeURIComponent(task.name) + '.json', { headers }, (err, resp, body) => {
              const meta = ((body || {}).metas || [])[0]
              if (meta) {
                db.map.set(meta.id, task.id)
                mapToKitsu[task.id] = meta.id
                meta.type = 'series'
                metas.push(meta)
              }
              cb()
            })
          }, 1)
          queue.drain = () => {
            cache.catalog[url] = metas
            // cache for 2 days (feed) / 6 hours (search)
            setTimeout(() => {
              delete cache.catalog[url]
            }, args.id == 'animefever-list' ? 172800000 : 21600000)
            if (redisKey)
              db.catalog.set(redisKey, page, metas)
            if (!redisMetas)
              resolve({ metas, cacheMaxAge: 172800 })
          }
          series.forEach(el => { queue.push(el) })
        } else if (!redisMetas)
          reject(new Error('Catalog error: '+JSON.stringify(args)))
      })

    })

  })
})

const kitsuEndpoint = 'https://addon.stremio-kitsu.cf'

addon.defineMetaHandler(args => {
  return new Promise((resolve, reject) => {
    needle.get(kitsuEndpoint + '/meta/' + args.type + '/' + args.id + '.json', (err, resp, body) => {
      if (body && body.meta)
        resolve(body)
      else
        reject(new Error('Could not get meta from kitsu api for: '+args.id))
    })
  })
})

function findEpisode(afId, episode, page, cb) {
  // guess page
  const getPage = page || Math.ceil(episode / 30)
  needle.post(endpoint + 'details/episodes', { id: afId, page: getPage }, { headers, json: true }, (err, resp, body) => {
    const episodes = (body || {}).data || []
    let epData
    episodes.some(ep => {
      const epNr = parseInt(ep.number)
      if (epNr == episode || (!epNr && !episode)) {
        epData = ep
        return true
      }
    })

    if (!epData && getPage == 1 && episodes.length == 1)
      epData = episodes[0]

    if (!epData && !page && getPage != 1 && episodes.length) {
      // guess page again with new found data
      if (episodes[0].number) {
        const epNr = parseInt(episodes[0].number)
        const expected = ((getPage -1) * 30) || 1
        if (expected < epNr) {
          const difference = epNr - expected
          const newPage = Math.ceil((episode - difference) / 30)
          findEpisode(apId, episode, newPage, cb)
          return
        }
      }
    }

    cb(epData)
  })
}

function getHost(str) {
  let host = pUrl(str).hostname
  const hostParts = host.split('.')
  if (hostParts.length > 2) {
    hostParts.shift()
    host = hostParts.join('.')
  }
  return host
}

addon.defineStreamHandler(args => {
  return new Promise((resolve, reject) => {
    const id = args.id
    const cacheMaxAge = 604800
    db.get(id, cacheMaxAge, cached => {
      if (cached) {
        resolve(cached)
        return
      }
      const idParts = id.split(':')
      const kitsuId = 'kitsu:' + idParts[1]
      const episode = idParts.length > 2 ? idParts[idParts.length -1] : 1
      db.map.get(kitsuId, afId => {
        if (afId) {
          findEpisode(afId, episode, null, epData => {
            if (epData) {
              console.log(epData)
              console.log(endpoint + 'episode/' + epData.id)
              needle.get(endpoint + 'episode/' + epData.id, { headers }, (err, resp, body) => {
                const stream = (body || {}).stream || ''
                if (stream) {
                  needle.get(stream, { headers }, (err, resp, body) => {
                    if (body && body.length) {
                      const playlist = m3u(body)
                      const playlists = (playlist || {}).playlists || []
                      function toStream(obj) {
                        const res = (((obj || {}).attributes || {}).RESOLUTION || {}).height || ''
                        let streamUrl = stream.split('/')
                        streamUrl[streamUrl.length -1] = obj.uri
                        streamUrl = streamUrl.join('/')                      
                        return {
                          title: (res ? res + 'p' : 'Stream') + '\n' + getHost(stream),
                          url: streamUrl
                        }
                      }
                      const sources = playlists.map(toStream)
                      if (sources && sources.length) {
                        db.set(id, sources)
                        resolve({ streams: sources, cacheMaxAge })
                      } else
                        reject(new Error('Playlist empty for: ' + id))
                    }
                  })
                } else
                  reject(new Error('No playlist url for: '+ id))
              })
            } else
              reject('Could not get stream sources for: ' + id)
          })
        } else 
          reject('Could not get streams for: ' + id)
      })
    })
  })
})

let genres = []

const getGenres = () => {
  return new Promise((resolve, reject) => {
    // these categories have no anime results:
    const blacklist = ['Adventure', 'Cars', 'Comedy', 'Dementia', 'Kids', 'Samurai', 'Shounen Ai', 'Vampire', 'Yaoi', 'Yuri']
    function toManifestGenres(gens) {
      return gens.map(el => { return el.name }).filter(el => { return blacklist.indexOf(el) == -1 })
    }
    db.genres.get(cachedGenres => {

      if (cachedGenres) {
        genres = cachedGenres
        manifest.catalogs[1].genres = toManifestGenres(genres)
        resolve()
        return
      }

      needle.get(endpoint + 'genres', { headers }, (err, resp, body) => {
        if (body && Array.isArray(body)) {
          genres = body
          db.genres.set(genres)
          manifest.catalogs[1].genres = toManifestGenres(genres)
        }
        resolve()
      })

    })
  })
}

module.exports = getGenres().then(() => {
  return addon.getInterface()
})
