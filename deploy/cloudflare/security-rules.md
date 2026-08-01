# Cloudflare activation template

Apply these controls only after the zone/domain and traffic baseline are known.
Cloudflare plan capabilities differ; use the equivalent dashboard/API rule
available to the selected plan.

## Required platform controls

- Proxy the public hostname or route it through the outbound-only tunnel.
- Keep HTTP and network DDoS managed protection enabled at recommended/default sensitivity.
- Enable the Cloudflare Managed Ruleset and OWASP managed ruleset in log/simulate
  mode first, then challenge/block after reviewing false positives.
- Enable Bot Fight Mode or the plan-equivalent bot control; exclude verified
  bots only through a narrow, reviewed rule.
- Do not create a DNS-only record that exposes the origin used by the application.

## Rate-limit rule groups

Use exact hostname, path and method conditions. Start from analytics-derived
thresholds; the values below are categories, not production thresholds.

## Optional adaptive-login edge signal

For suspicious login traffic that is still forwarded to the origin, create an
origin request-header transform that overwrites
`X-BiddingFlow-Edge-Risk: challenge`. Apply it only to the exact production
hostname and `POST /api/auth/login`, using the reviewed bot/risk expression
available on the Cloudflare plan. Remove or overwrite any visitor-supplied
header of the same name on traffic that does not match.

The application treats this marker as escalation-only: a matching value can
require Turnstile immediately, but no header value can disable Turnstile,
change validation results or bypass application rate limits. Keep
`TURNSTILE_EDGE_CHALLENGE_HEADER` and `TURNSTILE_EDGE_CHALLENGE_VALUE`
identical to the transform. Leave both empty if the edge plan does not provide
a reliable transform.

### Authentication and email actions

```text
http.host eq "REPLACE_WITH_PRODUCTION_DOMAIN"
and http.request.method eq "POST"
and http.request.uri.path in {
  "/api/auth/login"
  "/api/auth/register"
  "/api/auth/forgot-password"
  "/api/auth/resend-code"
  "/api/auth/verify"
}
```

Action sequence: log → Managed Challenge → temporary block. Where response
counting is available, count failed `401`, `403` and application `429`
separately from successful login traffic.

### Expensive document and lookup actions

```text
http.host eq "REPLACE_WITH_PRODUCTION_DOMAIN"
and (
  starts_with(http.request.uri.path, "/api/export")
  or http.request.uri.path eq "/api/import-excel"
  or http.request.uri.path eq "/api/templates/upload"
  or starts_with(http.request.uri.path, "/api/lookup-tax-code")
  or starts_with(http.request.uri.path, "/api/address/")
  or http.request.uri.path contains "/documents/"
)
```

Apply stricter per-session/user limits in the application and a broader IP/bot
limit at edge. Do not cache private downloads or authenticated API responses.

### General API burst

```text
http.host eq "REPLACE_WITH_PRODUCTION_DOMAIN"
and starts_with(http.request.uri.path, "/api/")
```

Allow normal UI bursts derived from p99 traffic, then challenge traffic above
the burst. Keep static assets on a separate cache path so normal page loads do
not consume the API budget.

### WebSocket handshake

```text
http.host eq "REPLACE_WITH_PRODUCTION_DOMAIN"
and http.request.uri.path eq "/ws/sync"
```

Limit handshake bursts at edge. The application independently enforces
cluster-wide per-IP and per-user connection leases.

## Origin verification

After activation:

1. Public DNS resolves to Cloudflare, not the origin.
2. Host firewall has no public rule for application/reverse-proxy ports.
3. Direct-IP requests fail; tunnel requests with the configured Host succeed.
4. `/metrics`, `/health/live` and `/health/ready` remain unavailable through
   the public hostname.
5. WAF/rate-limit events appear in analytics and origin request volume drops
   when a test rule challenges traffic.
