const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs').promises; 
const sharp = require('sharp');
require('dotenv').config();

const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
    console.error("🛑 Error: GOOGLE_API_KEY not found in environment variables.");
    console.error("Please create a .env file in the project root with GOOGLE_API_KEY=YOUR_API_KEY");
    process.exit(1);
}

let genAI;
try {
    genAI = new GoogleGenerativeAI(API_KEY);
    console.log("Gemini API configured successfully.");
} catch (e) {
    console.error(`🛑 Error configuring Gemini API: ${e.message}`);
    process.exit(1);
}

async function extractInfoFromDocument(imagePath) {

    try {
        console.log(`Loading image from: ${imagePath}`);

        try {
            await fs.access(imagePath);
        } catch (e) {
            console.error(`🛑 Error: Image file not found at ${imagePath}`);
            return null;
        }

        const image = sharp(imagePath);
        const metadata = await image.metadata();
        const imageBuffer = await image.toBuffer(); 

        const mimeType = `image/${metadata.format}`; 

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

Return the extracted information as a single, valid JSON object. Do not include any other text.
`;

        console.log(`Sending request to Gemini for image: ${path.basename(imagePath)}`);
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: imageBuffer.toString('base64'),
                    mimeType: mimeType
                }
            }
        ]);

        const response = result.response;
        console.log("Response received from Gemini.");

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
            console.log(`Successfully parsed JSON for ${path.basename(imagePath)}`);
            return extractedData;
        } catch (jsonErr) {
            console.warn(`⚠️ Failed to parse Gemini response as JSON for ${path.basename(imagePath)}. Error: ${jsonErr.message}`);
            console.debug(`Raw response text was: ${response.text()}`);
            return { error: "Failed to parse JSON response", raw_response: response.text() };
        }

    } catch (e) {
        console.error(`🛑 An error occurred during Gemini API call for ${path.basename(imagePath)}: ${e.message}`);
        return null;
    }
}

async function main() {
    const imageFile = 'pan.jpg'; 

    const extractedInfo = await extractInfoFromDocument(imageFile);

    if (extractedInfo) {
        console.log("\n--- Extracted Information ---");
        console.log(JSON.stringify(extractedInfo, null, 2));
    } else {
        console.log("\n--- Extraction Failed ---");
        console.log("Could not extract information. Check logs for details.");
    }
}

main().catch(console.error); 