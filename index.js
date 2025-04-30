const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const dotenv = require('dotenv');
const path = require('path');
const sharp = require('sharp'); 

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_API_KEY;
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-1.5-flash";

if (!API_KEY) {
    console.error("🛑 FATAL ERROR: GOOGLE_API_KEY environment variable not set.");
    process.exit(1); 
}

let genAI;
try {
    genAI = new GoogleGenerativeAI(API_KEY);
    console.log(`Gemini API configured successfully for model: ${MODEL_NAME}`);
} catch (e) {
    console.error(`🛑 Error configuring Gemini API: ${e.message}`);
    process.exit(1);
}

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB file size limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images are allowed.'), false);
        }
    }
});

async function extractInfoFromDocument(imageBuffer, mimeType) {

    if (!Buffer.isBuffer(imageBuffer) || !mimeType || !mimeType.startsWith('image/')) {
        console.error("🛑 Invalid input: Image buffer or MIME type missing/invalid.");
        return { error: "Invalid image data provided", details: "Buffer or MIME type is invalid." };
    }

    try {
        const model = genAI.getGenerativeModel({
             model: MODEL_NAME,
             // Optional: Adjust safety settings if needed, e.g., for potentially sensitive documents
             // Be aware of policy implications when lowering thresholds.
             safetySettings: [
                 { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                 { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                 { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                 { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
             ]
        });

        // Use the detailed prompt from your example
        const prompt = `
Analyze the provided image, which contains a document. Your primary goal is to classify the document type and extract key information accurately.

1.  **Document Classification (Mandatory):**
    * Identify the document type from the following list:
        * Identity Documents: Indian Aadhaar Card, Indian PAN Card, Passport (specify country if possible), Driving License (specify country/state), Voter ID Card (specify country), Government-issued ID Card, Office/Employee ID Card.
        * Personal Certificates: Birth Certificate, Marriage Certificate, Death Certificate.
        * Educational Documents: School Marksheet/Grade Report, School Leaving Certificate/Transfer Certificate, College/University Marksheet/Transcript, College/University Degree Certificate, College/University Provisional Certificate, College/University ID Card.
        * Official/Business Documents: Utility Bill (specify type), Bank Statement, Invoice/Receipt, Official Letter/Notification, Payslip/Salary Slip.
        * Other: (Specify, e.g., Rental Agreement, Medical Prescription).
        * Unknown: If the document type is unidentifiable.
    * The \`document_type\` field in the JSON output must match one of the above, with added context if applicable (e.g., "Driving License (Gujarat, India)"). If 'Other', provide a more specific \`document_subtype\` if possible.

2.  **Information Extraction:**
    * Extract all applicable fields from the following list. If a field is not present, irrelevant, or illegible, use \`null\`.
    * Format dates as \`YYYY-MM-DD\` when possible. If ambiguous, retain the original text.
    * Be precise in your OCR and ensure accurate placement of data in the JSON structure.

**Potential Fields:** (Include all relevant fields; use \`null\` if not applicable)

* \`document_type\`: (Mandatory Classification from Step 1)
* \`country_context\`: (e.g., "India", "USA")
* \`state_context\`: (e.g., "Gujarat", "California")
* \`issuing_authority\`: (e.g., "UIDAI", "Income Tax Department")
* \`document_number\`: (e.g., Aadhaar No, PAN, Passport No.)
* \`full_name\`:
* \`date_of_birth\`: (YYYY-MM-DD)
* \`gender\`: ("Male", "Female", "Other" or as on doc)
* \`father_name\`:
* \`mother_name\`:
* \`spouse_name\`:
* \`address\`:
* \`issue_date\`: (YYYY-MM-DD)
* \`expiry_date\`: (YYYY-MM-DD)
* \`date_of_registration\`: (YYYY-MM-DD)
* \`place_of_birth\`:
* \`place_of_issue\`:
* \`nationality\`:
* \`institution_name\`:
* \`program_name\` / \`course_name\` / \`degree_name\`: (Educational documents)
* \`enrollment_number\` / \`roll_number\` / \`student_id\`:
* \`session\` / \`academic_year\`: (e.g., "2022-2023")
* \`grade\` / \`marks\` / \`percentage\` / \`cgpa\` / \`result_status\`: (e.g., "Pass")
* \`date_of_admission\`: (YYYY-MM-DD)
* \`date_of_leaving\` / \`date_of_completion\` / \`date_of_graduation\`: (YYYY-MM-DD)
* \`employee_id\`:
* \`designation\` / \`job_title\`:
* \`department\`:
* \`date_of_joining\`: (YYYY-MM-DD)
* \`vehicle_class\`: (Driving License, e.g., "MCWG", "LMV")
* \`blood_group\`:
* \`bill_period\` / \`statement_period\`: (e.g., "March 2024")
* \`due_date\`: (YYYY-MM-DD)
* \`total_amount_due\`:
* \`issuer_name\`:
* \`recipient_name\`:
* \`reference_number\`:
* \`subject\`: (Letters)
* Include any other pertinent fields.

**Output:**

Return the extracted information as a single, valid JSON object. Do not include any other text, explanations, or markdown formatting like \`\`\`json.
`;

        console.log(`Sending request to Gemini model ${MODEL_NAME} for image processing.`);

        const generationConfig = {
            temperature: 0.2, // Lower temperature for more deterministic output(0 to 1)
             topK: 1,
            topP: 1,
            maxOutputTokens: 2048, // Adjust as needed
            responseMimeType: "application/json", // Request JSON directly if model supports it well
        };

        const parts = [
            { text: prompt },
            {
                inlineData: {
                    mimeType: mimeType,
                    data: imageBuffer.toString("base64")
                }
            }
        ];

        const result = await model.generateContent(parts, generationConfig);
        const response = result.response;

        console.log("Response received from Gemini.");

        if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
             let jsonData;
            try {
                jsonData = JSON.parse(response.candidates[0].content.parts[0].text);
                 console.log(`Successfully parsed JSON response from Gemini.`);
                 return jsonData;
            } catch(jsonErr) {
                 console.warn(`⚠️ Failed to parse direct JSON response from Gemini. Error: ${jsonErr.message}`);
                 console.debug(`Raw response text was: ${response.candidates[0].content.parts[0].text}`);
            }
        }

        let rawText = response.text().trim();
        if (rawText.startsWith("```json")) {
            rawText = rawText.substring(7);
        }
        if (rawText.endsWith("```")) {
            rawText = rawText.slice(0, -3);
        }
        rawText = rawText.trim();

        try {
            const extractedData = JSON.parse(rawText);
            console.log(`Successfully parsed JSON from text response.`);
            return extractedData;
        } catch (jsonErr) {
            console.warn(`⚠️ Failed to parse Gemini text response as JSON. Error: ${jsonErr.message}`);
            console.debug(`Raw response text was: ${response.text()}`);
            if (!response.candidates?.length || response.promptFeedback?.blockReason) {
                 console.error(`Request blocked. Reason: ${response.promptFeedback?.blockReason}`, response.promptFeedback);
                return { error: `Content blocked by API`, details: `Reason: ${response.promptFeedback?.blockReason || 'Unknown'}` };
            }
            return { error: "Failed to parse JSON response from AI", raw_response: response.text() };
        }

    } catch (e) {
        console.error(`🛑 An error occurred during Gemini API call: ${e.message}`, e);
        if (e.message && e.message.includes('SAFETY')) {
            return { error: "Content blocked due to safety settings", details: e.message };
        }
        return { error: "An error occurred while communicating with the AI service", details: e.message };
    }
}

const app = express();

app.use((req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${clientIp}`);
    next();
});


app.get("/", (req, res) => {
    res.status(200).json({ status: "OK", message: "Document Information Extractor API is running." });
});

app.post("/extract-id-info/", upload.single('file'), async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!req.file) {
        console.warn(`Upload attempt failed: No file provided from ${clientIp}`);
        return res.status(400).json({ detail: "No file uploaded. Please include a file named 'file' in your request." });
    }

    const file = req.file;
    console.log(`Received upload: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB), MIME: ${file.mimetype} from ${clientIp}`);

    try {
        const imageBuffer = file.buffer;
        const mimeType = file.mimetype;

        const extractedData = await extractInfoFromDocument(imageBuffer, mimeType);

        if (!extractedData) {
             console.error(`Critical error: No data returned from extractInfoFromDocument for ${file.originalname}`);
             return res.status(500).json({ detail: "Internal server error: Failed to get response from processing function." });
        }

        if (extractedData.error) {
            console.error(`Error processing file '${file.originalname}': ${extractedData.error} - Details: ${extractedData.details}`);
            // Determine appropriate status code
            let statusCode = 500; // Default internal server error
            if (extractedData.error.toLowerCase().includes("invalid")) {
                statusCode = 400; // Bad request (e.g., invalid image data)
            } else if (extractedData.error.toLowerCase().includes("blocked")) {
                 statusCode = 400; // Or 422 Unprocessable Entity if preferred for content issues
            } else if (extractedData.error.toLowerCase().includes("parse json")) {
                 statusCode = 502; // Bad Gateway (AI service returned unexpected format)
            }

            return res.status(statusCode).json({
                detail: `Failed to process document: ${extractedData.error}`,
                ...(extractedData.details && { details: extractedData.details }), // Include details if present
                ...(extractedData.raw_response && { raw_response: extractedData.raw_response }) // Optionally include raw for debugging
            });
        } else {
            console.log(`Successfully processed file '${file.originalname}' from ${clientIp}`);
            res.status(200).json(extractedData);
        }

    } catch (error) {
        console.error(`Unexpected server error processing file '${file.originalname}' from ${clientIp}: ${error.message}`, error);
        res.status(500).json({ detail: `An unexpected internal server error occurred: ${error.message}` });
    }
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        console.warn(`Multer error: ${err.message}`);
        return res.status(400).json({ detail: `File upload error: ${err.message}` });
    } else if (err) {
         if (err.message.includes('Invalid file type')) {
             console.warn(`Invalid file type upload attempt: ${err.message}`);
             return res.status(400).json({ detail: err.message });
         }
        console.error(`Unknown error during request processing: ${err.message}`, err);
        return res.status(500).json({ detail: `An internal server error occurred: ${err.message}` });
    }
    next(err);
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`🔑 Using Gemini Model: ${MODEL_NAME}`);
    console.log("📝 Endpoint available: POST /extract-id-info/");
});