const fs = require('fs')
const https = require('https')

async function downloadFile (url, targetFile) {  
    return await new Promise((resolve, reject) => {
      https.get(url, response => {
        const code = response.statusCode ?? 0
  
        if (code >= 400) {
          return reject(new Error(response.statusMessage))
        }
  
        // handle redirects
        if (code > 300 && code < 400 && !!response.headers.location) {
          return resolve(
            downloadFile(response.headers.location, targetFile)
          )
        }
  
        // save the file to disk
        const fileWriter = fs
          .createWriteStream(targetFile)
          .on('finish', () => {
            resolve({})
          })
  
        response.pipe(fileWriter)
      }).on('error', error => {
        reject(error)
      })
    })
}

module.exports = {
    downloadFile
}
