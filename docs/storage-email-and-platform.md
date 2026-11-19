# FrontDeskWise storage, email, and platform operations

This document covers the production-shaped foundation for organization documents, transactional email, and the super-admin control plane.

## Runtime behavior

### Organization documents

Document metadata is stored in PostgreSQL in `organization_documents`. The file bytes are stored in a private S3 bucket under this key layout:

```text
organizations/{organization_id}/businesses/{business_id|organization}/documents/{document_id}/{safe_file_name}
```

The API never proxies file bytes through the application server:

1. An authenticated organization owner/admin requests a presigned upload URL.
2. The browser uploads directly to S3 with a short-lived URL and AES-256 server-side encryption.
3. The API verifies the object with `HeadObject`, marks the database row `uploaded`, and starts private extraction.
4. PDF, TXT/Markdown/CSV/JSON/RTF, DOCX, and XLS/XLSX content is parsed into a document source and tenant-scoped knowledge chunks; the existing embedding worker runs when configured.
5. Downloads use a separate short-lived presigned URL.

All document routes require organization membership and, for business documents, owner/admin access to that business. Deleted documents remain as audit metadata with status `deleted`; their S3 object is removed.

The first supported content types are PDF, plain text, Markdown, CSV, JSON, RTF, DOCX, and Excel files. Legacy `.doc` uploads return a clear conversion message. The default limit is 25 MB and can be changed with `FRONTDESKWISE_MAX_DOCUMENT_BYTES`.

### SES

SES is used for FrontDeskWise-owned transactional messages, currently:

- a super-admin SES test from the `/platform` control plane;
- a non-blocking notification to `FRONTDESKWISE_SUPER_ADMIN_EMAILS` when a new demo request is submitted.

Firebase remains responsible for Firebase Auth password-reset email. SES does not receive Firebase private credentials.

### Super-admin URL

The customer app and control plane share the same SPA. Once the allowlisted Firebase account signs in, the control plane is available at:

```text
https://app.frontdeskwise.com/platform
```

`https://frontdeskwise.com/platform` also works if the main domain serves the same web deployment. The API authorizes super-admin access server-side using `FRONTDESKWISE_SUPER_ADMIN_EMAILS` plus the `super_admin_users` table.

## AWS setup

### 1. Create the private S3 bucket

Create one bucket for the environment, for example:

```text
frontdeskwise-documents-production
```

Recommended bucket settings:

- Block all public access.
- Keep Object Ownership as bucket owner enforced.
- Enable default encryption with SSE-S3 (`AES256`) or a customer-managed KMS key.
- Enable versioning if you want recovery from accidental overwrites.
- Do not put `AWS_SECRET_ACCESS_KEY` in the web app or in source control.

The application uses an organization-specific object prefix. Do not grant users direct bucket credentials; they only receive short-lived presigned URLs.

### 2. Configure S3 CORS

Apply CORS to the bucket, replacing the origins with the exact deployed web origins:

```json
[
  {
    "AllowedOrigins": [
      "https://frontdeskwise.com",
      "https://www.frontdeskwise.com",
      "https://app.frontdeskwise.com"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

### 3. Create least-privilege AWS permissions

Attach an IAM policy to the Render runtime identity. Replace the bucket name before using it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FrontDeskWiseObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::frontdeskwise-documents-production/organizations/*"
    },
    {
      "Sid": "FrontDeskWiseBucketMetadata",
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::frontdeskwise-documents-production"
    },
    {
      "Sid": "FrontDeskWiseSesSend",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*"
    }
  ]
}
```

If Render is configured with an IAM role or native AWS identity, use the role instead of long-lived access keys. If access keys are required, store them only as Render secret environment variables and rotate them periodically.

### 4. Verify the SES identity

In the same AWS region as `AWS_REGION`:

1. Verify `hello@frontdeskwise.com`, or verify the entire `frontdeskwise.com` domain.
2. Publish the SES DKIM records in DNS.
3. Configure SPF and DMARC for the domain.
4. If the account is still in SES sandbox, verify each recipient used for testing or request production access before sending to arbitrary prospects.
5. Set the verified sender in `FRONTDESKWISE_SES_FROM_EMAIL`.

## Render environment mapping

Set these on `frontdeskwise-api` in Render. The checked-in examples contain placeholders only.

```ini
AWS_REGION=us-east-1
FRONTDESKWISE_S3_BUCKET=frontdeskwise-documents-production
FRONTDESKWISE_MAX_DOCUMENT_BYTES=26214400
FRONTDESKWISE_SES_FROM_EMAIL=hello@frontdeskwise.com
FRONTDESKWISE_SES_FROM_NAME=FrontDeskWise
FRONTDESKWISE_SES_REPLY_TO=hello@frontdeskwise.com
AWS_ACCESS_KEY_ID=<least-privilege-runtime-key-if-not-using-an-iam-role>
AWS_SECRET_ACCESS_KEY=<least-privilege-runtime-secret-if-not-using-an-iam-role>
FRONTDESKWISE_SUPER_ADMIN_EMAILS=hello@frontdeskwise.com
WEB_ORIGIN=https://frontdeskwise.com,https://www.frontdeskwise.com,https://app.frontdeskwise.com
```

For the web deployment, keep only public Firebase configuration and the API origin:

```ini
VITE_API_ORIGIN=https://api.frontdeskwise.com
VITE_SITE_ORIGIN=https://frontdeskwise.com
```

Never put AWS keys, SES settings, Stripe secrets, webhook signing secrets, database credentials, or `FRONTDESKWISE_CREDENTIAL_KEY` in `VITE_*` variables.

## Verification checklist

After Render redeploys:

1. `GET https://api.frontdeskwise.com/health` should report `objectStorageConfigured: true` and `emailConfigured: true`.
2. Sign in with the Firebase user whose email is `hello@frontdeskwise.com`.
3. Open `https://app.frontdeskwise.com/platform`.
4. Click **Test SES email** and confirm delivery.
5. Open a business, go to **Knowledge**, upload a PDF or text file, and confirm it moves from `uploaded`/`processing` to `ready`.
6. Download the document and verify the browser receives a short-lived S3 URL.
7. Remove the document and confirm it disappears from the active list.
8. Submit a landing-page demo request and confirm the super-admin notification arrives; a delivery failure must not fail the demo crawl.
9. Review the API logs and S3 access logs/CloudTrail if enabled.

The database migrations include `015_organization_documents.sql`, `016_business_ownership_verification.sql`, `017_document_ingestion.sql`, and `018_model_routing_observability.sql`. Render runs the complete forward-only chain through the existing `preDeployCommand: npm run db:migrate`.
