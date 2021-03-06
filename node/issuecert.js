const cron = require('node-cron')
const fetch = require('node-fetch')

const config = {
  "apiKey": process.env.CF_API_KEY,
  "email": process.env.CF_API_EMAIL,
  "parentZoneName": process.env.CF_ZONE
}

const IssueCert = ({
  customerHostname,
  validationMethod = 'http',
  customOriginServer
}) => {

  // Set required headers for all Cloudflare API calls
  const hdrs = {
    "Content-Type": "application/json",
    "X-Auth-Email": config.email,
    "X-Auth-Key": config.apiKey
  }

  const customHostnamePayload = (function() {

    // Set the customHostname and validation method for provisioning your customer's cert
    let jsonPayload = {
      "hostname": customerHostname,
      "ssl": {
        "method": validationMethod,
        "type": "dv"
      }
    }

    // If specified in customOriginServer parameter, amend the jsoncustomcustomHostnamePayload to
    // include a custom origin server
    if (customOriginServer !== undefined) {
      jsonPayload["custom_origin_server"] = `${customOriginServer}`;
    }
    console.log(jsonPayload);
    return JSON.stringify(jsonPayload)
  })();

  let zoneID = ''

  // Return a promise that returns the zoneID for your whitelabeled zone when fulfilled
  const validateZone = () => {
    return Promise.resolve(fetch('https://api.cloudflare.com/client/v4/zones', {
        method: 'GET',
        headers: hdrs
      })
      .then(res => res.json())
      .then(json => {
        let i = 0
        while (i < json.result.length) {
          if (json.result[i].name === config.parentZoneName) {
            // Log and return the zoneID that corresponds with your whitelabeled zone name
            console.log(json.result[i].id)
            zoneID = json.result[i].id
            return zoneID
            break
          }
          i++
        }
      }))
  }

  const requestCert = () => {
    console.log(customHostnamePayload);
    return fetch(`https://api.cloudflare.com/client/v4/zones/${zoneID}/custom_hostnames`, {
        method: 'POST',
        body: customHostnamePayload,
        headers: hdrs
      })
      .then(res => res.json())
      .then(body => {
        console.log(body)
        return (body.success).toString()
      })
      .catch(function(e) {
        console.log(e)
      })
  }

  // Here, we set a cron job to monitor the status of the certificate
  const scheduleStatusCheck = cron.schedule('*/15 * * * * *', () => {
    return getCertStatus()
  })

  // Make API calls to Cloudflare's custom hostnames endpoint, and print the
  // status of the customer's certificate issuance once the json response
  // has been received
  const getCertStatus = () => {

    return fetch(`https://api.cloudflare.com/client/v4/zones/${zoneID}/custom_hostnames?hostname=${customerHostname}`, {
        method: 'GET',
        headers: hdrs
      })
      .then(res => res.json())
      .then(body => {
        return printCertDetailsFromEdge(body)
      })
      .catch(function(e) {
        console.log(e)
      })
  }

  // Print a statement with the current status of the certificate issue
  // pending_validation: the customer has pointed a cname record to saasprovider.com.
  // pending_issuance: Cloudflare's CA has received the certificate request
  // pending_deployment: Cloudflare's CA has approved the request
  // active: Cloudflare has received the cert and is now serving it
  const printCertDetailsFromEdge = (body) => {
    switch (body.result[0].ssl.status) {
      case 'pending_validation':
        console.log(`${customerHostname} still awaiting ${validationMethod} validation`)
        break;

      case 'pending_issuance':
        console.log(`Issuance pending for ${customerHostname}`);
        break;

      case 'pending_deployment':
        console.log(`Certificate issued for ${customerHostname}. Now pending deployment`);
        break;

        // End the cron job when the certificate is provisioned.
      case 'active':
        console.log(`Certificate Provisioned for: ${customerHostname}`)
        scheduleStatusCheck.destroy()
        break

      default:
        console.log(`${customerHostname} status unknown`)
        break
    }
  }

  return validateZone()
    .then(() => {
      return requestCert()
    })
    .then(() => {
      return scheduleStatusCheck
    })
    .catch(function(e) {
      console.log(e)
    })
}

module.exports = IssueCert
