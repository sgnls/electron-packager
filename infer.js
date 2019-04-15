'use strict'

const debug = require('debug')('electron-packager')
const getPackageInfo = require('get-package-info')
const parseAuthor = require('parse-author')
const path = require('path')
const resolve = require('resolve')
const semver = require('semver')

function isMissingRequiredProperty (props) {
  return props.some(prop => prop === 'productName' || prop === 'dependencies.electron')
}

function errorMessageForProperty (prop) {
  let hash, propDescription
  switch (prop) {
    case 'productName':
      hash = 'name'
      propDescription = 'application name'
      break
    case 'dependencies.electron':
      hash = 'electronversion'
      propDescription = 'Electron version'
      break
    default:
      hash = ''
      propDescription = '[Unknown Property]'
  }

  return `Unable to determine ${propDescription}. Please specify an ${propDescription}\n\n` +
    'For more information, please see\n' +
    `https://github.com/electron-userland/electron-packager/blob/master/docs/api.md#${hash}\n`
}

function resolvePromise (id, options) {
  // eslint-disable-next-line promise/param-names
  return new Promise((accept, reject) => {
    resolve(id, options, (err, mainPath, pkg) => {
      if (err) {
        /* istanbul ignore next */
        reject(err)
      } else {
        accept([mainPath, pkg])
      }
    })
  })
}

async function getVersion (opts, electronProp) {
  const [depType, packageName] = electronProp.prop.split('.')
  const src = electronProp.src
  if (packageName === 'electron-prebuilt-compile') {
    // electron-prebuilt-compile cannot be resolved because `main` does not point
    // to a valid JS file.
    const electronVersion = electronProp.pkg[depType][packageName]
    const versionRange = new semver.Range(electronVersion)
    if (versionRange.intersects(new semver.Range('< 1.6.5'))) {
      if (!/^\d+\.\d+\.\d+/.test(electronVersion)) {
        throw new Error('Using electron-prebuilt-compile with Electron Packager requires specifying an exact Electron version')
      }

      opts.electronVersion = electronVersion
      return Promise.resolve()
    }
  }

  const pkg = (await resolvePromise(packageName, { basedir: path.dirname(src) }))[1]
  debug(`Inferring target Electron version from ${packageName} in ${src}`)
  opts.electronVersion = pkg.version
  return null
}

async function handleMetadata (opts, result) {
  if (result.values.productName) {
    debug(`Inferring application name from ${result.source.productName.prop} in ${result.source.productName.src}`)
    opts.name = result.values.productName
  }

  if (result.values.version) {
    debug(`Inferring appVersion from version in ${result.source.version.src}`)
    opts.appVersion = result.values.version
  }

  if (result.values.author && !opts.win32metadata) {
    opts.win32metadata = {}
  }

  if (result.values.author) {
    debug(`Inferring win32metadata.CompanyName from author in ${result.source.author.src}`)
    if (typeof result.values.author === 'string') {
      opts.win32metadata.CompanyName = parseAuthor(result.values.author).name
    } else if (result.values.author.name) {
      opts.win32metadata.CompanyName = result.values.author.name
    } else {
      debug('Cannot infer win32metadata.CompanyName from author, no name found')
    }
  }

  if (result.values['dependencies.electron']) {
    return getVersion(opts, result.source['dependencies.electron'])
  } else {
    return Promise.resolve()
  }
}

module.exports = async function getMetadataFromPackageJSON (platforms, opts, dir) {
  let props = []
  if (!opts.name) props.push(['productName', 'name'])
  if (!opts.appVersion) props.push('version')
  if (!opts.electronVersion) {
    props.push([
      'dependencies.electron',
      'devDependencies.electron',
      'dependencies.electron-nightly',
      'devDependencies.electron-nightly',
      'dependencies.electron-prebuilt-compile',
      'devDependencies.electron-prebuilt-compile',
      'dependencies.electron-prebuilt',
      'devDependencies.electron-prebuilt'
    ])
  }

  if (platforms.includes('win32') && !(opts.win32metadata && opts.win32metadata.CompanyName)) {
    props.push('author')
  }

  // Name and version provided, no need to infer
  if (props.length === 0) return Promise.resolve()

  // Search package.json files to infer name and version from
  try {
    const result = await getPackageInfo(props, dir)
    return handleMetadata(opts, result)
  } catch (err) {
    if (err.missingProps) {
      const missingProps = err.missingProps.map(prop => {
        return Array.isArray(prop) ? prop[0] : prop
      })

      if (isMissingRequiredProperty(missingProps)) {
        const messages = missingProps.map(errorMessageForProperty)

        debug(err.message)
        err.message = messages.join('\n') + '\n'
        throw err
      } else {
        // Missing props not required, can continue w/ partial result
        return handleMetadata(opts, err.result)
      }
    }

    throw err
  }
}
