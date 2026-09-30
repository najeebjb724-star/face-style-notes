# CloudBase deployment contract

The model service is not ready for production traffic until the source-photo
deletion worker (Task 11), dependency release gate, and real CloudBase tests pass.

Deploy `cloudfunctions/analysisApi` as a CloudBase function with an HTTP gateway
route to its `main` entry. The route receives only model-container callbacks.
It accepts `POST` requests with a short-lived job bearer credential for `claim`
or a per-job lease bearer credential for `complete` and `fail`. Do not put the
route URL or any secret in the mini-program bundle. Keep function database and
storage permissions limited to this application environment.

Configure the following environment variables after AppID and EnvId exist:

| Runtime | Variable | Value |
| --- | --- | --- |
| `analysisApi` cloud function | `FACE_ANALYSIS_URL` | HTTPS `/analyze` endpoint of the CloudBase model container |
| `analysisApi` cloud function | `PHOTO_URL_HOSTS` | Exact comma-separated hosts returned by CloudBase temporary photo URLs |
| Model container | `CREDENTIAL_CONSUMER_URL` | HTTPS HTTP-gateway URL of `analysisApi` `main` |
| Model container | `PHOTO_URL_HOSTS` | Same exact photo-host allowlist |

Cloud function `main` must be reachable both from mini-program `callFunction`
and from the container via the HTTP gateway. The HTTP gateway request must
preserve `httpMethod`, `headers`, and `body`. Model-container access to the
gateway is authorized by the per-job bearer credentials; the gateway must not
expose a general database API. Configure the function timeout to cover model
processing and the container's dispatch response. Configure one model request
at a time per container instance; the service itself returns HTTP 429 when busy.

Before enabling traffic, run `npm run test:face-analysis-release`, verify the
CloudBase database rules, and test one consented photo end to end. Confirm the
report is generated, the original photo is removed, and a failed/abandoned
upload is also removed within 30 minutes. Never send AppSecret or cloud account
keys in chat or commit them to this repository.
