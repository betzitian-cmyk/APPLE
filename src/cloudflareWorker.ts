// Cloudflare Worker implementation for Invoice Extractor
// This replaces the Express server for Cloudflare deployment

export interface Env {
  OPENROUTER_API_KEY: string;
  ADOBE_CLIENT_ID: string;
  ADOBE_CLIENT_SECRET: string;
  PDF_SERVICE_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  APP_URL: string;
  SESSION_SECRET: string;
}

// Simple session management using cookies
function getSession(request: Request): { tokens?: any; connected: boolean } {
  const sessionCookie = request.headers.get('Cookie') || '';
  const match = sessionCookie.match(/session=([^;]+)/);
  
  if (!match) {
    return { connected: false };
  }
  
  try {
    const sessionData = JSON.parse(atob(match[1]));
    return {
      tokens: sessionData.tokens,
      connected: !!sessionData.tokens
    };
  } catch {
    return { connected: false };
  }
}

function setSessionCookie(tokens: any): string {
  const sessionData = btoa(JSON.stringify({ tokens }));
  return `session=${sessionData}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${24 * 60 * 60}`;
}

// Google OAuth2 helper
function getOAuth2Client(env: Env, appUrl: string) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${appUrl}/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials not configured");
  }

  if (!appUrl) {
    throw new Error("APP_URL environment variable is missing");
  }

  return { clientId, clientSecret, redirectUri };
}

// Adobe PDF Services token cache
let adobeTokenCache: { token: string; expires: number } | null = null;

async function getAdobeToken(env: Env): Promise<string> {
  const now = Date.now();
  
  if (adobeTokenCache && adobeTokenCache.expires > now) {
    return adobeTokenCache.token;
  }

  const clientId = env.ADOBE_CLIENT_ID;
  const clientSecret = env.ADOBE_CLIENT_SECRET;
  const pdfServiceUrl = env.PDF_SERVICE_URL || "https://pdf-services.adobe.io";

  const response = await fetch(`${pdfServiceUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get Adobe token: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const token = data.access_token;
  
  // Cache token for 1 hour (Adobe tokens typically expire in 1 hour)
  adobeTokenCache = {
    token,
    expires: now + (60 * 60 * 1000) - (5 * 60 * 1000) // 5 min buffer
  };

  return token;
}

// Handle multipart form data for file uploads
async function parseMultipartFormData(request: Request): Promise<{ file: File; field: string } | null> {
  const contentType = request.headers.get('Content-Type') || '';
  
  if (!contentType.includes('multipart/form-data')) {
    return null;
  }

  const boundary = contentType.split('boundary=')[1];
  if (!boundary) return null;

  const body = await request.arrayBuffer();
  const decoder = new TextDecoder();
  const text = decoder.decode(body);
  
  // Simple multipart parsing
  const parts = text.split(`--${boundary}`);
  
  for (const part of parts) {
    if (part.includes('Content-Disposition: form-data;') && part.includes('filename=')) {
      const filenameMatch = part.match(/filename="([^"]+)"/);
      const nameMatch = part.match(/name="([^"]+)"/);
      
      if (filenameMatch && nameMatch) {
        const filename = filenameMatch[1];
        const fieldName = nameMatch[1];
        
        // Find the actual file content
        const contentStart = part.indexOf('\r\n\r\n') + 4;
        const contentEnd = part.lastIndexOf('\r\n');
        const fileContent = part.substring(contentStart, contentEnd);
        
        // Convert to Uint8Array
        const fileData = new TextEncoder().encode(fileContent);
        
        return {
          field: fieldName,
          file: new File([fileData], filename, {
            type: getMimeTypeFromFilename(filename)
          })
        };
      }
    }
  }
  
  return null;
}

function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp'
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

// Main worker handler
export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const appUrl = env.APP_URL || url.origin;

    try {
      // Google OAuth routes
      if (url.pathname === '/api/auth/google/url' && request.method === 'GET') {
        try {
          const oauth2Client = getOAuth2Client(env, appUrl);
          const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${oauth2Client.clientId}&redirect_uri=${encodeURIComponent(oauth2Client.redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email')}&access_type=offline&prompt=consent`;
          
          return Response.json({ url: authUrl });
        } catch (error: any) {
          return Response.json({ error: error.message }, { status: 500 });
        }
      }

      if ((url.pathname === '/auth/google/callback' || url.pathname === '/auth/google/callback/') && request.method === 'GET') {
        const code = url.searchParams.get('code');
        if (!code) {
          return new Response('No code provided', { status: 400 });
        }

        try {
          const oauth2Client = getOAuth2Client(env, appUrl);
          
          // Exchange code for tokens
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              code,
              client_id: oauth2Client.clientId,
              client_secret: oauth2Client.clientSecret,
              redirect_uri: oauth2Client.redirectUri,
              grant_type: 'authorization_code',
            }),
          });

          if (!tokenResponse.ok) {
            throw new Error(`Token exchange failed: ${tokenResponse.status}`);
          }

          const tokens = await tokenResponse.json();
          
          // Set session cookie
          const sessionCookie = setSessionCookie(tokens);
          
          return new Response(`
            <html>
              <body>
                <script>
                  if (window.opener) {
                    window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                    window.close();
                  } else {
                    window.location.href = '/';
                  }
                </script>
                <p>Authentication successful. This window should close automatically.</p>
              </body>
            </html>
          `, {
            headers: {
              'Content-Type': 'text/html',
              'Set-Cookie': sessionCookie
            }
          });
        } catch (error: any) {
          return new Response(`Authentication failed: ${error.message}`, { status: 500 });
        }
      }

      if (url.pathname === '/api/auth/google/status' && request.method === 'GET') {
        const { connected } = getSession(request);
        return Response.json({ connected });
      }

      // Google Sheets append
      if (url.pathname === '/api/sheets/append' && request.method === 'POST') {
        const { connected: isConnected, tokens } = getSession(request);
        
        if (!tokens) {
          return Response.json({ error: "Not connected to Google Sheets. Please click 'Connect Sheets' first." }, { status: 401 });
        }

        try {
          const data = await request.json();
          const { spreadsheetId, data: sheetData } = data;
          
          if (!sheetData) {
            return Response.json({ error: "No data provided" }, { status: 400 });
          }

          // Use Google APIs via fetch
          let targetSpreadsheetId = spreadsheetId;
          
          if (!targetSpreadsheetId) {
            // Create new spreadsheet
            const createResponse = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                properties: { title: "Extracted Invoices" },
                sheets: [{
                  properties: {
                    title: "Invoices",
                    gridProperties: { frozenRowCount: 1 }
                  }
                }]
              }),
            });

            if (!createResponse.ok) {
              throw new Error(`Failed to create spreadsheet: ${createResponse.status}`);
            }

            const spreadsheet = await createResponse.json();
            targetSpreadsheetId = spreadsheet.spreadsheetId;

            // Add headers
            const headers = [
              "Invoice #", "PO #", "Date", "Due Date", "Vendor", "BN", "GST/HST #", "QST #", "PST/RST #", "Total", "Currency", "Tax Group", "Tax", "Subtotal", "Summary"
            ];
            
            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/Invoices!A1:update?valueInputOption=RAW`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ values: [headers] })
            });
          }

          // Append data
          const values = [
            sheetData.invoiceNumber || "",
            sheetData.poNumber || "",
            sheetData.date || "",
            sheetData.dueDate || "",
            sheetData.vendorName || "",
            sheetData.vendorTaxNumbers?.businessNumber || "",
            sheetData.vendorTaxNumbers?.gstHst || "",
            sheetData.vendorTaxNumbers?.qst || "",
            sheetData.vendorTaxNumbers?.pst || sheetData.vendorTaxNumbers?.rst || "",
            sheetData.total || 0,
            sheetData.currency || "",
            sheetData.taxGroup || "",
            sheetData.tax || 0,
            sheetData.subtotal || 0,
            sheetData.summary || ""
          ];

          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/Invoices!A:append?valueInputOption=USER_ENTERED`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokens.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [values] })
          });

          return Response.json({ success: true, spreadsheetId: targetSpreadsheetId });
        } catch (error: any) {
          console.error("Sheets API error:", error);
          return Response.json({ error: error.message }, { status: 500 });
        }
      }

      // PDF extraction endpoint
      if (url.pathname === '/api/extract' && request.method === 'POST') {
        try {
          const multipart = await parseMultipartFormData(request);
          
          if (!multipart || !multipart.file) {
            return Response.json({ error: "No file uploaded" }, { status: 400 });
          }

          const file = multipart.file;
          const fileMimeType = file.type;
          const isImage = fileMimeType.startsWith("image/");
          const adobeApiKey = env.ADOBE_CLIENT_ID;
          const pdfServiceUrl = env.PDF_SERVICE_URL || "https://pdf-services.adobe.io";

          console.log(`Starting extraction for file: ${file.name} (Type: ${fileMimeType})`);

          // 1. Get Access Token
          const token = await getAdobeToken(env);

          // 2. Get Upload Presigned URL
          const assetResponse = await fetch(`${pdfServiceUrl}/assets`, {
            method: 'POST',
            headers: {
              'X-API-Key': adobeApiKey,
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ mediaType: fileMimeType }),
          });

          if (!assetResponse.ok) {
            throw new Error(`Adobe asset creation failed: ${assetResponse.status}`);
          }

          const assetData = await assetResponse.json();
          const { uploadUri, assetID: initialAssetID } = assetData;

          if (!uploadUri || !initialAssetID) {
            throw new Error("Adobe API response missing uploadUri or assetID");
          }

          // 3. Upload Document
          const fileBuffer = await file.arrayBuffer();
          await fetch(uploadUri, {
            method: 'PUT',
            headers: {
              'Content-Type': fileMimeType,
            },
            body: fileBuffer,
          });

          let finalAssetID = initialAssetID;

          // 4. If image, convert to PDF first
          if (isImage) {
            console.log("Converting image to PDF...");
            const createResponse = await fetch(`${pdfServiceUrl}/operation/createpdf/`, {
              method: 'POST',
              headers: {
                'X-API-Key': adobeApiKey,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ assetID: initialAssetID }),
            });

            const statusUrl = createResponse.headers.get('Location');
            if (!statusUrl) {
              throw new Error("No status URL returned from create PDF operation");
            }

            let createAttempts = 0;
            const maxCreateAttempts = 30;
            let pdfAssetID = "";

            while (createAttempts < maxCreateAttempts) {
              const statusResponse = await fetch(statusUrl, {
                headers: {
                  'X-API-Key': adobeApiKey,
                  'Authorization': `Bearer ${token}`,
                },
              });

              const statusData = await statusResponse.json();

              if (statusData.status === "done") {
                if (statusData.content && statusData.content.assetID) {
                  pdfAssetID = statusData.content.assetID;
                  break;
                } else {
                  throw new Error("Adobe image-to-pdf conversion succeeded but no assetID was returned");
                }
              } else if (statusData.status === "failed") {
                throw new Error("Adobe image-to-pdf conversion failed");
              }

              await new Promise(resolve => setTimeout(resolve, 2000));
              createAttempts++;
            }

            if (!pdfAssetID) {
              throw new Error("Image-to-pdf conversion timed out");
            }
            finalAssetID = pdfAssetID;
          }

          // 5. Extract PDF
          console.log("Extracting structured data...");
          const extractResponse = await fetch(`${pdfServiceUrl}/operation/extractpdf/`, {
            method: 'POST',
            headers: {
              'X-API-Key': adobeApiKey,
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              assetID: finalAssetID,
              getCharBounds: false,
              includeStyling: false,
              elementsToExtract: ["text", "tables"],
            }),
          });

          const statusUrl = extractResponse.headers.get('Location');
          if (!statusUrl) {
            throw new Error("No status URL returned from extract operation");
          }

          // 6. Poll for Status
          let downloadUri = "";
          let attempts = 0;
          const maxAttempts = 30;

          while (attempts < maxAttempts) {
            const statusResponse = await fetch(statusUrl, {
              headers: {
                'X-API-Key': adobeApiKey,
                'Authorization': `Bearer ${token}`,
              },
            });

            const statusData = await statusResponse.json();

            if (statusData.status === "done") {
              if (statusData.content && statusData.content.downloadUri) {
                downloadUri = statusData.content.downloadUri;
                break;
              } else {
                throw new Error("Adobe extraction succeeded but no downloadUri was returned");
              }
            } else if (statusData.status === "failed") {
              throw new Error("Adobe extraction failed");
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            attempts++;
          }

          if (!downloadUri) {
            throw new Error("Extraction timed out");
          }

          // 7. Download Result
          console.log("Downloading result from:", downloadUri);
          const downloadResponse = await fetch(downloadUri);

          if (!downloadResponse.ok) {
            throw new Error(`Download failed with status ${downloadResponse.status}`);
          }

          const dataBuffer = await downloadResponse.arrayBuffer();
          let jsonResult: any = null;

          // Try parsing as JSON first
          try {
            const textContent = new TextDecoder().decode(dataBuffer).trim();
            if (textContent.startsWith("{") || textContent.startsWith("[")) {
              jsonResult = JSON.parse(textContent);
            }
          } catch (e) {}

          if (!jsonResult) {
            // Check if it's a ZIP file (PK header)
            const bytes = new Uint8Array(dataBuffer);
            if (dataBuffer.byteLength > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
              try {
                // Simple ZIP extraction for Cloudflare Workers
                const zipText = new TextDecoder().decode(dataBuffer);
                const jsonMatch = zipText.match(/"structuredData\.json":\s*"([^"]+)"/);
                if (jsonMatch) {
                  const jsonBase64 = jsonMatch[1];
                  jsonResult = JSON.parse(atob(jsonBase64));
                }
              } catch (zipError) {
                console.error("ZIP parsing error:", zipError);
              }
            }
          }

          // Final fallback
          if (!jsonResult) {
            try {
              jsonResult = JSON.parse(new TextDecoder().decode(dataBuffer));
            } catch (finalError) {
              throw new Error("Failed to extract JSON from Adobe response");
            }
          }

          return Response.json(jsonResult);
        } catch (error: any) {
          console.error("Extraction error:", error);
          
          let userMessage = "Failed to extract data from PDF.";
          let statusCode = 500;

          if (error.message?.includes('rate limit') || error.message?.includes('429')) {
            userMessage = "Adobe PDF Services rate limit exceeded. Please wait a moment and try again.";
            statusCode = 429;
          } else if (error.message?.includes('Unsupported')) {
            userMessage = "Unsupported file format. Please ensure you are uploading a valid PDF document.";
            statusCode = 415;
          } else if (error.message?.includes('too large')) {
            userMessage = "The uploaded file is too large for Adobe PDF Services to process.";
            statusCode = 413;
          } else if (error.message?.includes('authentication') || error.message?.includes('401') || error.message?.includes('403')) {
            userMessage = "Adobe API authentication failed. Please check your API credentials.";
            statusCode = error.message.includes('401') ? 401 : 403;
          }

          return Response.json({ 
            error: userMessage, 
            details: error.message 
          }, { status: statusCode });
        }
      }

      // OpenRouter AI parsing proxy
      if (url.pathname === '/api/ai/parse' && request.method === 'POST') {
        try {
          const apiKey = env.OPENROUTER_API_KEY;
          if (!apiKey) {
            return Response.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });
          }

          const { adobeData, imageData, systemInstruction, prompt } = await request.json();
          
          const messages: any[] = [
            { role: "system", content: systemInstruction }
          ];

          if (adobeData) {
            messages.push({ 
              role: "user", 
              content: `${prompt}\n\nAdobe Extraction Data:\n${JSON.stringify(adobeData)}` 
            });
          } else if (imageData) {
            messages.push({
              role: "user",
              content: [
                { type: "text", text: prompt },
                { 
                  type: "image_url", 
                  image_url: { 
                    url: `data:${imageData.mimeType};base64,${imageData.data}` 
                  } 
                }
              ]
            });
          }

          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': appUrl,
              'X-Title': 'Invoice AI Extractor',
            },
            body: JSON.stringify({
              model: "openrouter/free",
              messages,
              response_format: { type: "json_object" },
              stream: false
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
            return Response.json({ 
              error: errorData.error || `OpenRouter API error: ${response.status}`,
              details: errorData
            }, { status: response.status });
          }

          const result = await response.json();
          const content = result.choices?.[0]?.message?.content;
          
          if (!content) {
            throw new Error("No content in OpenRouter response");
          }

          // Clean the response text from markdown code blocks if present
          const cleanedText = content.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();

          try {
            return Response.json(JSON.parse(cleanedText));
          } catch (parseError) {
            console.error("Failed to parse AI response as JSON:", cleanedText);
            return Response.json({ error: "The AI returned an invalid JSON format. Please try again." }, { status: 500 });
          }
        } catch (error: any) {
          console.error("OpenRouter error:", error);
          
          let errorMessage = error.message || "An unexpected error occurred with the AI service.";
          let statusCode = 500;

          if (error.message?.includes('PaymentRequired') || error.message?.includes('402')) {
            errorMessage = "OpenRouter payment required or spend limit exceeded. Please check your OpenRouter account balance and API key limits.";
            statusCode = 402;
          } else if (error.message?.includes('rate limit') || error.message?.includes('429')) {
            errorMessage = "AI service rate limit exceeded. Please try again in a few moments.";
            statusCode = 429;
          } else if (error.message?.includes('401') || error.message?.includes('403')) {
            errorMessage = "AI service authentication failed. Please check your OpenRouter API key.";
            statusCode = 401;
          }

          return Response.json({ 
            error: errorMessage,
            details: error.message
          }, { status: statusCode });
        }
      }

      // Serve static files or SPA
      // In production, built assets would be served from a CDN or R2
      if (url.pathname.startsWith('/assets/') || url.pathname.match(/\.(js|css|html|ico|png|jpg|jpeg|svg|woff|woff2|ttf)$/)) {
        return new Response('Not found', { status: 404 });
      }

      // For all other routes, serve the SPA index.html
      const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/apple-touch-icon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Invoice AI Extractor</title>
    <meta name="description" content="Extract invoice data using AI" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });

    } catch (error: any) {
      console.error("Worker error:", error);
      return Response.json({ 
        error: "Internal server error", 
        details: error.message 
      }, { status: 500 });
    }
  },
};