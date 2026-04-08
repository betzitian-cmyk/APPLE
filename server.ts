import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import axios from "axios";
import { OpenRouter } from "@openrouter/sdk";
import fs from "fs";
import AdmZip from "adm-zip";
import os from "os";
import { google } from "googleapis";
import session from "express-session";

// Use OS temp directory for uploads to be more container-friendly
const upload = multer({ dest: path.join(os.tmpdir(), "uploads") });

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy is required for 'secure: true' cookies behind a proxy
  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET || 'invoice-extractor-secret',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: true,
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Logging middleware to help debug
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  // Google Sheets Integration
  const getOAuth2Client = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    // Ensure APP_URL doesn't have a trailing slash for consistency
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    const redirectUri = `${appUrl}/auth/google/callback`;

    if (!clientId || !clientSecret) {
      console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
      throw new Error("Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the Secrets panel.");
    }

    if (!appUrl) {
      console.error("Missing APP_URL environment variable");
      throw new Error("APP_URL environment variable is missing. This is required for OAuth callbacks.");
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  };

  app.get("/api/auth/google/url", (req, res) => {
    try {
      const oauth2Client = getOAuth2Client();
      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/userinfo.email"],
        prompt: "consent"
      });
      res.json({ url });
    } catch (error: any) {
      console.error("Error generating auth URL:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get(["/auth/google/callback", "/auth/google/callback/"], async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code provided");

    try {
      const oauth2Client = getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code as string);
      
      if (req.session) {
        (req.session as any).tokens = tokens;
        console.log("Tokens saved to session successfully");
      } else {
        console.error("Session object missing in callback");
      }

      res.send(`
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
      `);
    } catch (error: any) {
      console.error("OAuth callback error:", error);
      res.status(500).send(`Authentication failed: ${error.message}`);
    }
  });

  app.get("/api/auth/google/status", (req, res) => {
    const isConnected = !!(req.session && (req.session as any).tokens);
    console.log("Checking connection status:", isConnected);
    res.json({ connected: isConnected });
  });

  app.post("/api/sheets/append", async (req, res) => {
    if (!req.session || !(req.session as any).tokens) {
      console.warn("Append attempt without session tokens");
      return res.status(401).json({ error: "Not connected to Google Sheets. Please click 'Connect Sheets' first." });
    }

    const { spreadsheetId, data } = req.body;
    if (!data) return res.status(400).json({ error: "No data provided" });

    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials((req.session as any).tokens);

      const sheets = google.sheets({ version: "v4", auth: oauth2Client });

      let targetSpreadsheetId = spreadsheetId;

      // If no spreadsheetId provided, create a new one
      if (!targetSpreadsheetId) {
        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: "Extracted Invoices" },
            sheets: [{
              properties: {
                title: "Invoices",
                gridProperties: { frozenRowCount: 1 }
              }
            }]
          }
        });
        targetSpreadsheetId = (spreadsheet as any).data.spreadsheetId;

        // Add headers
        const headers = [
          "Invoice #", "PO #", "Date", "Due Date", "Vendor", "BN", "GST/HST #", "QST #", "PST/RST #", "Total", "Currency", "Tax Group", "Tax", "Subtotal", "Summary"
        ];
        await sheets.spreadsheets.values.update({
          spreadsheetId: targetSpreadsheetId!,
          range: "Invoices!A1",
          valueInputOption: "RAW",
          requestBody: { values: [headers] }
        });
      }

      // Append data
      const values = [
        data.invoiceNumber || "",
        data.poNumber || "",
        data.date || "",
        data.dueDate || "",
        data.vendorName || "",
        data.vendorTaxNumbers?.businessNumber || "",
        data.vendorTaxNumbers?.gstHst || "",
        data.vendorTaxNumbers?.qst || "",
        data.vendorTaxNumbers?.pst || data.vendorTaxNumbers?.rst || "",
        data.total || 0,
        data.currency || "",
        data.taxGroup || "",
        data.tax || 0,
        data.subtotal || 0,
        data.summary || ""
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: targetSpreadsheetId!,
        range: "Invoices!A:A",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [values] }
      });

      res.json({ success: true, spreadsheetId: targetSpreadsheetId });
    } catch (error: any) {
      console.error("Sheets API error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Adobe PDF Services API Helper
  const getAdobeToken = async () => {
    const clientId = process.env.ADOBE_CLIENT_ID || "8a44f717a27644e58abee7c8aed34556";
    const clientSecret = process.env.ADOBE_CLIENT_SECRET || "p8e-Jh7cMUxjHVZjVl0rmQ7da9ofmNKNskO2";

    const response = await axios.post(
      `${process.env.PDF_SERVICE_URL || "https://pdf-services.adobe.io"}/token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    return response.data.access_token;
  };

  // API route for PDF extraction
  app.post("/api/extract", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const filePath = req.file.path;
      const fileMimeType = req.file.mimetype;
      const isImage = fileMimeType.startsWith("image/");
      const adobeApiKey = process.env.ADOBE_API_KEY || process.env.ADOBE_CLIENT_ID || "8a44f717a27644e58abee7c8aed34556";
      const pdfServiceUrl = process.env.PDF_SERVICE_URL || "https://pdf-services.adobe.io";

      console.log(`Starting extraction for file: ${req.file.originalname} (Type: ${fileMimeType})`);

      // 1. Get Access Token
      const token = await getAdobeToken();

      // 2. Get Upload Presigned URL
      const assetResponse = await axios.post(
        `${pdfServiceUrl}/assets`,
        { mediaType: fileMimeType },
        {
          headers: {
            "X-API-Key": adobeApiKey,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!assetResponse.data) {
        throw new Error("Adobe API returned an empty response for asset creation");
      }

      const { uploadUri, assetID: initialAssetID } = assetResponse.data;

      if (!uploadUri || !initialAssetID) {
        console.error("Adobe Asset Response Data:", assetResponse.data);
        throw new Error("Adobe API response missing uploadUri or assetID");
      }

      // 3. Upload Document
      const fileBuffer = fs.readFileSync(filePath);
      await axios.put(uploadUri, fileBuffer, {
        headers: {
          "Content-Type": fileMimeType,
        },
      });

      let finalAssetID = initialAssetID;

      // 4. If image, convert to PDF first
      if (isImage) {
        console.log("Converting image to PDF...");
        const createResponse = await axios.post(
          `${pdfServiceUrl}/operation/createpdf/`,
          { assetID: initialAssetID },
          {
            headers: {
              "X-API-Key": adobeApiKey,
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        const createStatusUrl = createResponse.headers.location;
        let createAttempts = 0;
        const maxCreateAttempts = 30;
        let pdfAssetID = "";

        while (createAttempts < maxCreateAttempts) {
          const statusResponse = await axios.get(createStatusUrl, {
            headers: {
              "X-API-Key": adobeApiKey,
              Authorization: `Bearer ${token}`,
            },
          });

          if (statusResponse.data.status === "done") {
            if (statusResponse.data.content && statusResponse.data.content.assetID) {
              pdfAssetID = statusResponse.data.content.assetID;
              break;
            } else {
              console.error("Adobe Status Response Data (Done but no assetID):", statusResponse.data);
              throw new Error("Adobe image-to-pdf conversion succeeded but no assetID was returned");
            }
          } else if (statusResponse.data.status === "failed") {
            throw new Error("Adobe image-to-pdf conversion failed");
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
          createAttempts++;
        }

        if (!pdfAssetID) {
          throw new Error("Image-to-pdf conversion timed out");
        }
        finalAssetID = pdfAssetID;
      }

      // 5. Extract PDF
      console.log("Extracting structured data...");
      const extractResponse = await axios.post(
        `${pdfServiceUrl}/operation/extractpdf/`,
        {
          assetID: finalAssetID,
          getCharBounds: false,
          includeStyling: false,
          elementsToExtract: ["text", "tables"],
        },
        {
          headers: {
            "X-API-Key": adobeApiKey,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const statusUrl = extractResponse.headers.location;

      // 6. Poll for Status
      let downloadUri = "";
      let attempts = 0;
      const maxAttempts = 30;

      while (attempts < maxAttempts) {
        const statusResponse = await axios.get(statusUrl, {
          headers: {
            "X-API-Key": adobeApiKey,
            Authorization: `Bearer ${token}`,
          },
        });

        if (statusResponse.data.status === "done") {
          if (statusResponse.data.content && statusResponse.data.content.downloadUri) {
            downloadUri = statusResponse.data.content.downloadUri;
            break;
          } else {
            console.error("Adobe Status Response Data (Done but no downloadUri):", statusResponse.data);
            throw new Error("Adobe extraction succeeded but no downloadUri was returned");
          }
        } else if (statusResponse.data.status === "failed") {
          throw new Error("Adobe extraction failed");
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;
      }

      if (!downloadUri) {
        throw new Error("Extraction timed out");
      }

      // 7. Download Result
      console.log("Downloading result from:", downloadUri);
      const downloadResponse = await axios.get(downloadUri, {
        responseType: "arraybuffer",
        validateStatus: () => true,
      });

      if (downloadResponse.status !== 200) {
        const errorText = Buffer.from(downloadResponse.data).toString("utf8").substring(0, 500);
        throw new Error(`Download failed with status ${downloadResponse.status}: ${errorText}`);
      }

      const dataBuffer = Buffer.from(downloadResponse.data);
      let jsonResult = null;

      // Try parsing as JSON first
      try {
        const textContent = dataBuffer.toString("utf8").trim();
        if (textContent.startsWith("{") || textContent.startsWith("[")) {
          jsonResult = JSON.parse(textContent);
        }
      } catch (e) {}

      if (!jsonResult) {
        // Check if it's a ZIP file
        if (dataBuffer.length > 4 && dataBuffer[0] === 0x50 && dataBuffer[1] === 0x4b) {
          try {
            const zip = new AdmZip(dataBuffer);
            const zipEntries = zip.getEntries();
            for (const entry of zipEntries) {
              if (entry.entryName === "structuredData.json") {
                jsonResult = JSON.parse(entry.getData().toString("utf8"));
                break;
              }
            }
          } catch (zipError) {}
        }
      }

      // Final fallback
      if (!jsonResult) {
        try {
          jsonResult = JSON.parse(dataBuffer.toString("utf8"));
        } catch (finalError) {
          throw new Error("Failed to extract JSON from Adobe response");
        }
      }

      // Cleanup
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      res.json(jsonResult);
    } catch (error: any) {
      console.error("Extraction error:", error.response?.data || error.message);
      
      let userMessage = "Failed to extract data from PDF.";
      let statusCode = 500;

      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (status === 429) {
          userMessage = "Adobe PDF Services rate limit exceeded. Please wait a moment and try again.";
          statusCode = 429;
        } else if (status === 415) {
          userMessage = "Unsupported file format. Please ensure you are uploading a valid PDF document.";
          statusCode = 415;
        } else if (status === 413) {
          userMessage = "The uploaded file is too large for Adobe PDF Services to process.";
          statusCode = 413;
        } else if (status === 401 || status === 403) {
          userMessage = "Adobe API authentication failed. Please check your API credentials.";
          statusCode = status;
        } else if (data && data.message) {
          userMessage = `Adobe API Error: ${data.message}`;
        }
      } else if (error.code === 'ECONNABORTED') {
        userMessage = "The request to Adobe PDF Services timed out. Please try again with a smaller file.";
        statusCode = 504;
      }

      res.status(statusCode).json({ 
        error: userMessage, 
        details: error.response?.data || error.message 
      });
    }
  });

  // OpenRouter API Proxy for Invoice Parsing
  app.post("/api/ai/parse", async (req, res) => {
    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "OPENROUTER_API_KEY not configured. Please set it in the Secrets panel." });
      }

      const openrouter = new OpenRouter({
        apiKey: apiKey
      });

      const { adobeData, imageData, systemInstruction, prompt } = req.body;
      
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

      const stream = await (openrouter.chat as any).send({
        chatRequest: {
          model: "openrouter/free",
          messages,
          response_format: { type: "json_object" },
          stream: true
        }
      });

      let responseText = "";
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          responseText += content;
        }
        
        if (chunk.usage) {
          console.log("OpenRouter Usage:", chunk.usage);
          if ((chunk.usage as any).reasoningTokens) {
            console.log("Reasoning tokens:", (chunk.usage as any).reasoningTokens);
          }
        }
      }

      // Clean the response text from markdown code blocks if present
      const cleanedText = responseText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();

      try {
        res.json(JSON.parse(cleanedText));
      } catch (parseError) {
        console.error("Failed to parse AI response as JSON:", cleanedText);
        throw new Error("The AI returned an invalid JSON format. Please try again.");
      }
    } catch (error: any) {
      console.error("OpenRouter SDK error:", error);
      
      let errorMessage = error.message || "An unexpected error occurred with the AI service.";
      let statusCode = 500;

      // Handle specific OpenRouter errors
      if (error.name === "PaymentRequiredResponseError" || error.message?.includes("PaymentRequired")) {
        errorMessage = "OpenRouter payment required or spend limit exceeded. Please check your OpenRouter account balance and API key limits.";
        statusCode = 402;
      } else if (error.message?.includes("Provider returned error")) {
        // Try to extract the raw error message if available
        try {
          const rawError = typeof error.raw === 'string' ? JSON.parse(error.raw) : error.raw;
          if (rawError?.error) {
            errorMessage = `AI Provider Error: ${rawError.error}`;
          }
        } catch (e) {
          // Fallback to original message
        }
      } else if (error.name === "TooManyRequestsResponseError" || error.status === 429 || error.message?.includes("rate limit")) {
        if (error.message?.includes("free-models-per-day")) {
          errorMessage = "OpenRouter free model daily limit reached. Please add credits to your OpenRouter account or wait until tomorrow.";
        } else {
          errorMessage = "AI service rate limit exceeded. Please try again in a few moments.";
        }
        statusCode = 429;
      } else if (error.status === 401 || error.status === 403) {
        errorMessage = "AI service authentication failed. Please check your OpenRouter API key.";
        statusCode = 401;
      }

      res.status(statusCode).json({ 
        error: errorMessage,
        details: error.raw || error.message
      });
    }
  });

  // Explicit 404 for API routes to prevent HTML fallback
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Vite middleware for development
  const isProd = process.env.NODE_ENV === "production" || fs.existsSync(path.join(process.cwd(), "dist"));
  
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      // Fallback if dist doesn't exist but we're in "prod"
      app.use(express.static(process.cwd()));
      app.get("*", (req, res) => {
        res.sendFile(path.join(process.cwd(), "index.html"));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
