import React, { useState, useRef } from "react";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Download, ChevronRight, Brain, Table, List, Trash2, Play, Clock, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ExtractionResult {
  elements: any[];
  [key: string]: any;
}

interface QueueItem {
  id: string;
  file: File;
  status: "pending" | "processing" | "completed" | "error";
  error?: string;
  rawResult?: ExtractionResult;
  parsedInvoice?: ParsedInvoice;
}

interface ParsedInvoice {
  invoiceNumber?: string;
  poNumber?: string;
  date?: string;
  dueDate?: string;
  vendorName?: string;
  vendorAddress?: string;
  vendorTaxNumbers?: {
    businessNumber?: string;
    gstHst?: string;
    pst?: string;
    qst?: string;
    rst?: string;
  };
  customerName?: string;
  customerAddress?: string;
  paymentTerms?: string;
  items: Array<{
    description: string;
    quantity?: number;
    unitPrice?: number;
    amount?: number;
    isTaxExempt?: boolean;
    taxBreakdown?: {
      gst?: number;
      pst?: number;
      hst?: number;
      qst?: number;
      rst?: number;
    };
    taxRate?: number;
  }>;
  subtotal?: number;
  tax?: number;
  taxBreakdown?: {
    gst?: number;
    pst?: number;
    hst?: number;
    qst?: number;
    rst?: number;
  };
  province?: string;
  taxGroup?: string;
  total?: number;
  currency?: string;
  summary?: string;
}

const CANADIAN_TAX_RATES: Record<string, { name: string; gst?: number; pst?: number; hst?: number; qst?: number; rst?: number; total: number }> = {
  "AB": { name: "Alberta", gst: 0.05, total: 0.05 },
  "BC": { name: "British Columbia", gst: 0.05, pst: 0.07, total: 0.12 },
  "MB": { name: "Manitoba", gst: 0.05, rst: 0.07, total: 0.12 },
  "NB": { name: "New Brunswick", hst: 0.15, total: 0.15 },
  "NL": { name: "Newfoundland and Labrador", hst: 0.15, total: 0.15 },
  "NS": { name: "Nova Scotia", hst: 0.15, total: 0.15 },
  "NT": { name: "Northwest Territories", gst: 0.05, total: 0.05 },
  "NU": { name: "Nunavut", gst: 0.05, total: 0.05 },
  "ON": { name: "Ontario", hst: 0.13, total: 0.13 },
  "PE": { name: "Prince Edward Island", hst: 0.15, total: 0.15 },
  "QC": { name: "Quebec", gst: 0.05, qst: 0.09975, total: 0.14975 },
  "SK": { name: "Saskatchewan", gst: 0.05, pst: 0.06, total: 0.11 },
  "YT": { name: "Yukon", gst: 0.05, total: 0.05 },
};

const PROVINCE_MAPPING: Record<string, string> = {
  "ALBERTA": "AB",
  "BRITISH COLUMBIA": "BC",
  "MANITOBA": "MB",
  "NEW BRUNSWICK": "NB",
  "NEWFOUNDLAND": "NL",
  "LABRADOR": "NL",
  "NOVA SCOTIA": "NS",
  "NORTHWEST TERRITORIES": "NT",
  "NUNAVUT": "NU",
  "ONTARIO": "ON",
  "PRINCE EDWARD ISLAND": "PE",
  "QUEBEC": "QC",
  "SASKATCHEWAN": "SK",
  "YUKON": "YT",
};

export default function App() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [viewMode, setViewMode] = useState<"ui" | "parsed" | "raw">("ui");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedItem = queue.find(item => item.id === selectedItemId);
  const rawResult = selectedItem?.rawResult || null;
  const parsedInvoice = selectedItem?.parsedInvoice || null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files) as File[];
      addFilesToQueue(selectedFiles);
    }
  };

  const addFilesToQueue = (files: File[]) => {
    const newItems: QueueItem[] = files
      .filter(file => file.type === "application/pdf" || file.type.startsWith("image/"))
      .map(file => ({
        id: Math.random().toString(36).substring(7),
        file,
        status: "pending"
      }));

    if (newItems.length < files.length) {
      setError("Some files were skipped. Please upload only PDF or image files.");
    } else {
      setError(null);
    }

    setQueue(prev => [...prev, ...newItems]);
    if (!selectedItemId && newItems.length > 0) {
      setSelectedItemId(newItems[0].id);
    }
  };

  const removeFile = (id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
    if (selectedItemId === id) {
      setSelectedItemId(null);
    }
  };

  const clearQueue = () => {
    if (isProcessing) return;
    setQueue([]);
    setSelectedItemId(null);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files) {
      const droppedFiles = Array.from(e.dataTransfer.files) as File[];
      addFilesToQueue(droppedFiles);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const parseWithAI = async (input: { adobeData: ExtractionResult }) => {
    try {
      const systemInstruction = `You are an expert Canadian invoice parser. Your task is to extract the key invoice details and return them in a clean, structured JSON format. 

Pay special attention to Canadian sales tax (GST, PST, HST, QST, RST) and identify the province of the vendor. 

CRITICAL: Extract Canadian Tax Identification Numbers:
1. Business Number (BN): A unique 9-digit identifier (e.g., 123456789).
2. GST/HST Registration Number: The 9-digit BN followed by 'RT' and a 4-digit account identifier (e.g., 123456789RT0001).
3. QST Registration Number (Quebec): Usually a 9-digit number followed by 'TQ' and a 4-digit account identifier (e.g., 123456789TQ0001).

For each line item (including products, services, and all fees like shipping, handling, environmental fees, etc.):
1. Extract the specific tax breakdown (GST, PST, etc.) as the AMOUNT of tax applied to that item.
2. Determine the total tax rate (e.g., 0.13 for 13%) applied to that specific item.
3. Identify if the item is tax-exempt or zero-rated based on the following Canadian rules (Source: https://accplus.ca/knowledge-base/personal-tax/tax-in-canada-things-that-are-not-taxed/):
   - Basic Groceries: Most food and beverages for human consumption (e.g., bread, milk, vegetables, fruit, meat, fish, cereal, cheese, butter, yogurt, eggs, flour, sugar). Note: Snack foods, candies, carbonated beverages, alcohol, and prepared foods (like restaurant meals) are NOT exempt.
   - Agricultural & Fishing: Farm livestock, poultry, bees, grain, raw wool, certain fishing equipment, farm equipment, seeds, and fertilizer.
   - Prescription Drugs & Medical Devices: Drugs prescribed by medical professionals, insulin, dispensing services, hearing aids, artificial limbs, artificial teeth, and other medical/dental devices like eyeglasses or contact lenses.
   - Feminine Hygiene Products: Tampons, pads, sanitary napkins, and similar products.
   - Exports: Goods and services exported from Canada.
   - Medical/Dental Services: Most health care services provided by practitioners (physicians, dentists, nurses, etc.).
   - Educational Services: Tuition for courses leading to a degree/diploma, and music lessons.
   - Financial Services: Most services provided by financial institutions (e.g., bank fees, interest, loans, insurance).
   - Residential Rents: Long-term residential rent (over 1 month) and sales of used residential housing.
   - Child Care: Most child care services (daycare).
   - Legal Aid: Services provided under a legal aid plan.

CRITICAL: All charges, including Shipping, Handling, Eco-fees, and Service fees, MUST be extracted as individual line items in the "items" array. Do NOT create a separate "additionalFees" field.

If an item has a tax code (like 'G' for GST, 'H' for HST, 'E' for Exempt, 'Z' for Zero-rated), use that to inform your extraction. 
Verify that the sum of item taxes matches the total tax reported on the invoice.

Return a JSON object with the following structure:
{
  "invoiceNumber": string | null,
  "poNumber": string | null,
  "date": string | null,
  "dueDate": string | null,
  "vendorName": string | null,
  "vendorAddress": string | null,
  "vendorTaxNumbers": {
    "businessNumber": string | null,
    "gstHst": string | null,
    "pst": string | null,
    "qst": string | null,
    "rst": string | null
  } | null,
  "customerName": string | null,
  "customerAddress": string | null,
  "paymentTerms": string | null,
  "items": Array<{
    "description": string,
    "quantity": number | null,
    "unitPrice": number | null,
    "amount": number | null,
    "isTaxExempt": boolean | null,
    "taxBreakdown": {
      "gst": number | null,
      "pst": number | null,
      "hst": number | null,
      "qst": number | null,
      "rst": number | null
    } | null,
    "taxRate": number | null
  }>,
  "subtotal": number | null,
  "tax": number | null,
  "taxBreakdown": {
    "gst": number | null,
    "pst": number | null,
    "hst": number | null,
    "qst": number | null,
    "rst": number | null
  } | null,
  "province": string | null,
  "total": number | null,
  "currency": string | null,
  "summary": string | null
}`;

      // Simplify data to focus on text content
      const adobeDataToPass = input.adobeData.elements
        .filter(el => el.Text || el.Table)
        .map(el => {
          if (el.Text) return { type: el.Path, text: el.Text };
          if (el.Table) return { type: "Table", content: "Table data present" };
          return null;
        })
        .filter(Boolean)
        .slice(0, 800);

      const prompt = "I will provide you with a JSON representation of an invoice extracted by Adobe PDF Services. Return the structured JSON. If a field is not found, set it to null. Ensure numbers are actual numbers, not strings.";

      const response = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adobeData: adobeDataToPass,
          systemInstruction,
          prompt
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "AI parsing failed");
      }

      const parsed = await response.json();
      
      // Post-process to set taxGroup and normalize province
      if (parsed && parsed.province) {
        let provinceCode = parsed.province.toUpperCase();
        if (provinceCode.length > 2) {
          const found = Object.entries(PROVINCE_MAPPING).find(([name]) => provinceCode.includes(name));
          if (found) provinceCode = found[1];
        }
        const rates = CANADIAN_TAX_RATES[provinceCode];
        if (rates) {
          parsed.taxGroup = rates.name;
          parsed.province = provinceCode; // Normalize to 2-letter code
        }
      }

      return parsed as ParsedInvoice;
    } catch (err: any) {
      console.error("AI parsing error:", err);
      throw err;
    }
  };

  const processItem = async (item: QueueItem) => {
    try {
      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "processing" } : q));
      
      const formData = new FormData();
      formData.append("file", item.file);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
        headers: {
          "Accept": "application/json",
        },
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error("Authentication error. Please refresh the page.");
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned non-JSON response. The server might be busy.");
      }

      const raw: ExtractionResult = await response.json();
      if (!response.ok) {
        throw new Error((raw as any)?.error || "Failed to extract data");
      }
      
      const parsed = await parseWithAI({ adobeData: raw });

      setQueue(prev => prev.map(q => q.id === item.id ? { 
        ...q, 
        status: "completed", 
        rawResult: raw, 
        parsedInvoice: parsed || undefined 
      } : q));
    } catch (err: any) {
      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "error", error: err.message } : q));
    }
  };

  const processAll = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    
    const pendingItems = queue.filter(item => item.status === "pending" || item.status === "error");
    
    // Process sequentially to respect potential rate limits and server load
    for (const item of pendingItems) {
      await processItem(item);
    }
    
    setIsProcessing(false);
  };

  const downloadJson = () => {
    let dataToDownload: any = null;
    let filename = "data.json";

    if (viewMode === "raw") {
      dataToDownload = rawResult;
      filename = `raw_adobe_${selectedItem?.file?.name.replace(/\.[^/.]+$/, "") || "data"}.json`;
    } else {
      dataToDownload = parsedInvoice;
      filename = `parsed_invoice_${selectedItem?.file?.name.replace(/\.[^/.]+$/, "") || "data"}.json`;
    }

    if (!dataToDownload) return;
    const blob = new Blob([JSON.stringify(dataToDownload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const escapeCsv = (val: any) => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    // If it contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const downloadCsv = () => {
    if (!parsedInvoice) return;

    const headers = [
      "Invoice Number", "PO Number", "Date", "Due Date", "Vendor Name", "Vendor Address", 
      "Business Number", "Vendor GST/HST #", "Vendor PST #", "Vendor QST #", "Vendor RST #",
      "Customer Name", "Customer Address", "Payment Terms", "Province",
      "Item Description", "Quantity", "Unit Price", "Item Amount", "Is Tax Exempt",
      "Item GST", "Item PST", "Item HST", "Item QST", "Item RST", "Item Tax Rate",
      "Subtotal", "Tax", "Total", "Currency", "Summary"
    ];

    const rows = (parsedInvoice.items || []).map(item => [
      escapeCsv(parsedInvoice.invoiceNumber),
      escapeCsv(parsedInvoice.poNumber),
      escapeCsv(parsedInvoice.date),
      escapeCsv(parsedInvoice.dueDate),
      escapeCsv(parsedInvoice.vendorName),
      escapeCsv(parsedInvoice.vendorAddress),
      escapeCsv(parsedInvoice.vendorTaxNumbers?.businessNumber),
      escapeCsv(parsedInvoice.vendorTaxNumbers?.gstHst),
      escapeCsv(parsedInvoice.vendorTaxNumbers?.pst),
      escapeCsv(parsedInvoice.vendorTaxNumbers?.qst),
      escapeCsv(parsedInvoice.vendorTaxNumbers?.rst),
      escapeCsv(parsedInvoice.customerName),
      escapeCsv(parsedInvoice.customerAddress),
      escapeCsv(parsedInvoice.paymentTerms),
      escapeCsv(parsedInvoice.province),
      escapeCsv(item.description),
      escapeCsv(item.quantity),
      escapeCsv(item.unitPrice),
      escapeCsv(item.amount),
      escapeCsv(item.isTaxExempt ? "Yes" : "No"),
      escapeCsv(item.taxBreakdown?.gst),
      escapeCsv(item.taxBreakdown?.pst),
      escapeCsv(item.taxBreakdown?.hst),
      escapeCsv(item.taxBreakdown?.qst),
      escapeCsv(item.taxBreakdown?.rst),
      escapeCsv(item.taxRate),
      escapeCsv(parsedInvoice.subtotal),
      escapeCsv(parsedInvoice.tax),
      escapeCsv(parsedInvoice.total),
      escapeCsv(parsedInvoice.currency),
      escapeCsv(parsedInvoice.summary)
    ]);

    // If no items, add one row with just header info
    if (rows.length === 0) {
      rows.push([
        escapeCsv(parsedInvoice.invoiceNumber),
        escapeCsv(parsedInvoice.poNumber),
        escapeCsv(parsedInvoice.date),
        escapeCsv(parsedInvoice.dueDate),
        escapeCsv(parsedInvoice.vendorName),
        escapeCsv(parsedInvoice.vendorAddress),
        escapeCsv(parsedInvoice.vendorTaxNumbers?.businessNumber),
        escapeCsv(parsedInvoice.vendorTaxNumbers?.gstHst),
        escapeCsv(parsedInvoice.vendorTaxNumbers?.pst),
        escapeCsv(parsedInvoice.vendorTaxNumbers?.qst),
        escapeCsv(parsedInvoice.vendorTaxNumbers?.rst),
        escapeCsv(parsedInvoice.customerName),
        escapeCsv(parsedInvoice.customerAddress),
        escapeCsv(parsedInvoice.paymentTerms),
        escapeCsv(parsedInvoice.province),
        "", "", "", "", "",
        "", "", "", "", "", "",
        escapeCsv(parsedInvoice.subtotal),
        escapeCsv(parsedInvoice.tax),
        escapeCsv(parsedInvoice.total),
        escapeCsv(parsedInvoice.currency),
        escapeCsv(parsedInvoice.summary)
      ]);
    }

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parsed_invoice_${selectedItem?.file?.name.replace(/\.[^/.]+$/, "") || "data"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // You could add a toast notification here
  };

  const isLikelyTaxExempt = (description: string) => {
    const desc = (description || "").toLowerCase();
    const exemptKeywords = [
      // Basic Groceries
      "milk", "bread", "vegetable", "fruit", "meat", "fish", "egg", "flour", "sugar", "cereal", "cheese", "butter", "yogurt",
      // Agricultural & Fishing
      "livestock", "poultry", "bees", "grain", "raw wool", "fishing equipment", "farm equipment", "seeds", "fertilizer",
      // Prescription Drugs & Medical Devices
      "prescription", "drugs", "medicine", "insulin", "hearing aid", "artificial limb", "artificial teeth", "medical device", "dental device", "eyeglasses", "contact lenses",
      // Feminine Hygiene
      "tampon", "sanitary napkin", "menstrual", "pad",
      // Services
      "tuition", "music lesson", "child care", "daycare", "legal aid", "health care", "medical service", "dental service",
      // Financial/Housing
      "bank fee", "interest", "residential rent", "mortgage", "insurance"
    ];
    
    // Check for snacks/candy/soda which are NOT exempt
    const taxableKeywords = [
      "candy", "snack", "carbonated", "soda", "pop", "prepared food", "restaurant", "alcohol", "beer", "wine", "spirits", 
      "tobacco", "cigarette", "cannabis", "marijuana"
    ];
    
    const isExempt = exemptKeywords.some(kw => desc.includes(kw));
    const isTaxable = taxableKeywords.some(kw => desc.includes(kw));
    
    return isExempt && !isTaxable;
  };

  const getExpectedTax = (invoice: ParsedInvoice) => {
    if (!invoice.province) return null;
    
    let provinceCode = invoice.province.toUpperCase();
    if (provinceCode.length > 2) {
      // Try to find by name
      const found = Object.entries(PROVINCE_MAPPING).find(([name]) => provinceCode.includes(name));
      if (found) provinceCode = found[1];
    }
    
    const rates = CANADIAN_TAX_RATES[provinceCode];
    if (!rates) return null;
    
    // Calculate taxable subtotal from items
    const taxableItemsAmount = (invoice.items || []).reduce((acc, item) => {
      // Use AI flag OR keyword-based check for exemption
      const isExempt = item.isTaxExempt || isLikelyTaxExempt(item.description);
      if (isExempt) return acc;
      return acc + (item.amount || 0);
    }, 0);

    // Total taxable base
    const totalTaxableBase = taxableItemsAmount || invoice.subtotal || 0;

    // Calculate expected taxes based on province rules
    let expectedGst = 0;
    let expectedPst = 0;
    let expectedHst = 0;
    let expectedQst = 0;
    let expectedRst = 0;

    if (rates.gst) expectedGst = totalTaxableBase * rates.gst;
    if (rates.pst) expectedPst = totalTaxableBase * rates.pst;
    if (rates.hst) expectedHst = totalTaxableBase * rates.hst;
    if (rates.qst) expectedQst = totalTaxableBase * rates.qst;
    if (rates.rst) expectedRst = totalTaxableBase * rates.rst;

    const totalExpectedTax = expectedGst + expectedPst + expectedHst + expectedQst + expectedRst;

    return {
      total: totalExpectedTax,
      breakdown: {
        gst: expectedGst,
        pst: expectedPst,
        hst: expectedHst,
        qst: expectedQst,
        rst: expectedRst
      },
      rates,
      taxableSubtotal: totalTaxableBase,
      provinceCode
    };
  };

  const expectedTaxData = parsedInvoice ? getExpectedTax(parsedInvoice) : null;
  const taxDiscrepancy = expectedTaxData && parsedInvoice?.tax !== undefined 
    ? Math.abs(expectedTaxData.total - parsedInvoice.tax) > 0.05 
    : false;

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-[#E2E8F0]">
      {/* Header */}
      <header className="border-b border-[#E5E7EB] bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#FA4F01] rounded-lg flex items-center justify-center">
              <FileText className="text-white w-5 h-5" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Invoice AI Extractor</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Adobe + Gemini AI</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Upload */}
          <div className="lg:col-span-4 space-y-8">
            <div className="space-y-2">
              <h2 className="text-3xl font-bold tracking-tight text-[#111827]">Smart Invoice Parsing</h2>
              <p className="text-[#6B7280] leading-relaxed">
                Upload your PDF or image invoice. We'll use Adobe for PDFs and Gemini AI's multimodal vision for images to extract and understand the contents.
              </p>
            </div>

            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`relative group cursor-pointer border-2 border-dashed rounded-2xl transition-all duration-300 p-10 text-center flex flex-col items-center justify-center gap-4 ${
                dragActive 
                  ? "border-[#FA4F01] bg-[#FFF5F2]" 
                  : "border-[#E5E7EB] hover:border-[#FA4F01] hover:bg-[#F9FAFB]"
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="application/pdf,image/*"
                className="hidden"
              />
              
              <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors duration-300 ${
                queue.length > 0 ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#F3F4F6] text-[#9CA3AF] group-hover:bg-[#FFF5F2] group-hover:text-[#FA4F01]"
              }`}>
                {queue.length > 0 ? <CheckCircle2 className="w-7 h-7" /> : <Upload className="w-7 h-7" />}
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-[#111827] text-sm">
                  {queue.length > 0 ? `${queue.length} files selected` : "Click to upload or drag and drop"}
                </p>
                <p className="text-xs text-[#6B7280]">
                  PDF or Image files
                </p>
              </div>
            </div>

            <button
              disabled={queue.length === 0 || isProcessing || !queue.some(i => i.status === "pending" || i.status === "error")}
              onClick={processAll}
              className={`w-full py-4 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-2 shadow-sm ${
                queue.length === 0 || isProcessing || !queue.some(i => i.status === "pending" || i.status === "error")
                  ? "bg-[#F3F4F6] text-[#9CA3AF] cursor-not-allowed"
                  : "bg-[#111827] text-white hover:bg-[#1F2937] active:scale-[0.98]"
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing Queue...
                </>
              ) : (
                <>
                  Process All Invoices
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </button>

            {/* Queue Section */}
            {queue.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-[#6B7280]">Queue ({queue.length})</h3>
                  <button 
                    onClick={clearQueue}
                    disabled={isProcessing}
                    className="text-xs text-[#B91C1C] hover:underline disabled:opacity-50"
                  >
                    Clear All
                  </button>
                </div>
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {queue.map((item) => (
                    <div 
                      key={item.id}
                      onClick={() => setSelectedItemId(item.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                        selectedItemId === item.id 
                          ? "bg-white border-[#FA4F01] shadow-sm" 
                          : "bg-[#F9FAFB] border-[#E5E7EB] hover:border-[#FA4F01]/50"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          item.status === "completed" ? "bg-[#DCFCE7] text-[#166534]" :
                          item.status === "error" ? "bg-[#FEF2F2] text-[#B91C1C]" :
                          item.status === "processing" ? "bg-[#FFF5F2] text-[#FA4F01]" :
                          "bg-white text-[#9CA3AF]"
                        }`}>
                          {item.status === "completed" ? <CheckCircle2 className="w-4 h-4" /> :
                           item.status === "error" ? <AlertCircle className="w-4 h-4" /> :
                           item.status === "processing" ? <Loader2 className="w-4 h-4 animate-spin" /> :
                           <Clock className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#111827] truncate">{item.file.name}</p>
                          <p className="text-[10px] text-[#6B7280] uppercase tracking-wider">
                            {item.status}
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(item.id);
                        }}
                        disabled={isProcessing && item.status === "processing"}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-[#9CA3AF] hover:text-[#B91C1C] transition-all disabled:opacity-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-[#FEF2F2] border border-[#FEE2E2] rounded-xl flex gap-3 text-[#B91C1C]"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div className="text-sm font-medium">{error}</div>
              </motion.div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-8">
            <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm overflow-hidden min-h-[500px] flex flex-col">
              <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between bg-[#F9FAFB]">
                <div className="flex items-center gap-2 md:gap-4 overflow-x-auto no-scrollbar">
                  <button
                    onClick={() => setViewMode("ui")}
                    className={`text-xs md:text-sm font-semibold flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                      viewMode === "ui" ? "bg-white shadow-sm text-[#111827]" : "text-[#6B7280] hover:text-[#111827]"
                    }`}
                  >
                    <List className="w-4 h-4" />
                    UI View
                  </button>
                  <button
                    onClick={() => setViewMode("parsed")}
                    className={`text-xs md:text-sm font-semibold flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                      viewMode === "parsed" ? "bg-white shadow-sm text-[#111827]" : "text-[#6B7280] hover:text-[#111827]"
                    }`}
                  >
                    <Brain className="w-4 h-4" />
                    Parsed JSON
                  </button>
                  <button
                    onClick={() => setViewMode("raw")}
                    className={`text-xs md:text-sm font-semibold flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                      viewMode === "raw" ? "bg-white shadow-sm text-[#111827]" : "text-[#6B7280] hover:text-[#111827]"
                    }`}
                  >
                    <Table className="w-4 h-4" />
                    Raw Adobe Data
                  </button>
                </div>
                {(parsedInvoice || rawResult) && (
                  <div className="flex items-center gap-2">
                    {viewMode !== "ui" && (
                      <button
                        onClick={() => copyToClipboard(JSON.stringify(viewMode === "raw" ? rawResult : parsedInvoice, null, 2))}
                        className="text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F3F4F6] transition-colors shrink-0"
                      >
                        Copy
                      </button>
                    )}
                    <button
                      onClick={downloadJson}
                      className="text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 bg-[#111827] text-white border border-[#111827] rounded-lg hover:bg-[#1F2937] transition-colors shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      JSON
                    </button>
                    {parsedInvoice && (
                      <div className="flex items-center gap-1 border-l border-[#E5E7EB] pl-2 ml-1">
                        <button
                          onClick={downloadCsv}
                          className="text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F3F4F6] transition-colors shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          CSV
                        </button>
                        {viewMode !== "ui" && (
                          <button
                            onClick={() => {
                              const headers = [
                                "Invoice Number", "PO Number", "Date", "Due Date", "Vendor Name", "Vendor Address", 
                                "Vendor GST/HST #", "Vendor PST #", "Vendor QST #", "Vendor RST #",
                                "Customer Name", "Customer Address", "Payment Terms", "Province",
                                "Item Description", "Quantity", "Unit Price", "Item Amount", "Is Tax Exempt",
                                "Item GST", "Item PST", "Item HST", "Item QST", "Item RST", "Item Tax Rate",
                                "Subtotal", "Tax", "Total", "Currency", "Summary"
                              ];
                              const rows = (parsedInvoice.items || []).map(item => [
                                escapeCsv(parsedInvoice.invoiceNumber),
                                escapeCsv(parsedInvoice.poNumber),
                                escapeCsv(parsedInvoice.date),
                                escapeCsv(parsedInvoice.dueDate),
                                escapeCsv(parsedInvoice.vendorName),
                                escapeCsv(parsedInvoice.vendorAddress),
                                escapeCsv(parsedInvoice.vendorTaxNumbers?.gstHst),
                                escapeCsv(parsedInvoice.vendorTaxNumbers?.pst),
                                escapeCsv(parsedInvoice.vendorTaxNumbers?.qst),
                                escapeCsv(parsedInvoice.vendorTaxNumbers?.rst),
                                escapeCsv(parsedInvoice.customerName),
                                escapeCsv(parsedInvoice.customerAddress),
                                escapeCsv(parsedInvoice.paymentTerms),
                                escapeCsv(parsedInvoice.province),
                                escapeCsv(item.description),
                                escapeCsv(item.quantity),
                                escapeCsv(item.unitPrice),
                                escapeCsv(item.amount),
                                escapeCsv(item.isTaxExempt ? "Yes" : "No"),
                                escapeCsv(item.taxBreakdown?.gst),
                                escapeCsv(item.taxBreakdown?.pst),
                                escapeCsv(item.taxBreakdown?.hst),
                                escapeCsv(item.taxBreakdown?.qst),
                                escapeCsv(item.taxBreakdown?.rst),
                                escapeCsv(item.taxRate),
                                escapeCsv(parsedInvoice.subtotal),
                                escapeCsv(parsedInvoice.tax),
                                escapeCsv(parsedInvoice.total),
                                escapeCsv(parsedInvoice.currency),
                                escapeCsv(parsedInvoice.summary)
                              ]);
                              if (rows.length === 0) {
                                rows.push([
                                  escapeCsv(parsedInvoice.invoiceNumber),
                                  escapeCsv(parsedInvoice.poNumber),
                                  escapeCsv(parsedInvoice.date),
                                  escapeCsv(parsedInvoice.dueDate),
                                  escapeCsv(parsedInvoice.vendorName),
                                  escapeCsv(parsedInvoice.vendorAddress),
                                  escapeCsv(parsedInvoice.vendorTaxNumbers?.gstHst),
                                  escapeCsv(parsedInvoice.vendorTaxNumbers?.pst),
                                  escapeCsv(parsedInvoice.vendorTaxNumbers?.qst),
                                  escapeCsv(parsedInvoice.vendorTaxNumbers?.rst),
                                  escapeCsv(parsedInvoice.customerName),
                                  escapeCsv(parsedInvoice.customerAddress),
                                  escapeCsv(parsedInvoice.paymentTerms),
                                  escapeCsv(parsedInvoice.province),
                                  "", "", "", "", "",
                                  "", "", "", "", "", "",
                                  escapeCsv(parsedInvoice.subtotal),
                                  escapeCsv(parsedInvoice.tax),
                                  escapeCsv(parsedInvoice.total),
                                  escapeCsv(parsedInvoice.currency),
                                  escapeCsv(parsedInvoice.summary)
                                ]);
                              }
                              const csvContent = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
                              copyToClipboard(csvContent);
                            }}
                            className="text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F3F4F6] transition-colors shrink-0"
                          >
                            Copy CSV
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 p-6 overflow-auto max-h-[700px]">
                {/* Empty State */}
                {!selectedItem && (
                  <div className="h-full flex flex-col items-center justify-center text-[#9CA3AF] gap-3 py-32 text-center max-w-sm mx-auto">
                    <FileText className="w-16 h-16 opacity-10" />
                    <p className="text-lg font-medium">Select an item from the queue to view extraction results</p>
                  </div>
                )}

                {/* Loading State for Selected Item */}
                {selectedItem?.status === "processing" && (
                  <div className="space-y-8 py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-[#F3F4F6] rounded-full animate-pulse"></div>
                      <div className="space-y-2 flex-1">
                        <div className="h-4 bg-[#F3F4F6] rounded w-1/4 animate-pulse"></div>
                        <div className="h-3 bg-[#F3F4F6] rounded w-1/2 animate-pulse"></div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="h-4 bg-[#F3F4F6] rounded w-full animate-pulse"></div>
                      <div className="h-4 bg-[#F3F4F6] rounded w-5/6 animate-pulse"></div>
                      <div className="h-4 bg-[#F3F4F6] rounded w-4/6 animate-pulse"></div>
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-20 bg-[#F3F4F6] rounded-xl animate-pulse"></div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error State for Selected Item */}
                {selectedItem?.status === "error" && (
                  <div className="h-full flex flex-col items-center justify-center text-[#B91C1C] gap-4 py-32 text-center max-w-sm mx-auto">
                    <div className="w-16 h-16 bg-[#FEF2F2] rounded-full flex items-center justify-center">
                      <AlertCircle className="w-8 h-8" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-lg font-bold">Processing Failed</p>
                      <p className="text-sm text-[#6B7280]">{selectedItem.error}</p>
                    </div>
                    <button 
                      onClick={() => processItem(selectedItem)}
                      className="px-6 py-2 bg-[#111827] text-white rounded-lg text-sm font-semibold hover:bg-[#1F2937]"
                    >
                      Retry Extraction
                    </button>
                  </div>
                )}

                {/* Pending State */}
                {selectedItem?.status === "pending" && (
                  <div className="h-full flex flex-col items-center justify-center text-[#6B7280] gap-4 py-32 text-center max-w-sm mx-auto">
                    <div className="w-16 h-16 bg-[#F3F4F6] rounded-full flex items-center justify-center">
                      <Clock className="w-8 h-8 opacity-20" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-lg font-bold">Pending Extraction</p>
                      <p className="text-sm">This file is in the queue and waiting to be processed.</p>
                    </div>
                    <button 
                      onClick={() => processItem(selectedItem)}
                      disabled={isProcessing}
                      className="px-6 py-2 bg-[#111827] text-white rounded-lg text-sm font-semibold hover:bg-[#1F2937] disabled:opacity-50"
                    >
                      Process Now
                    </button>
                  </div>
                )}

                {/* Results View */}
                {selectedItem?.status === "completed" && (
                  <>
                    {viewMode === "ui" && parsedInvoice && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-8"
                  >
                    {/* Summary Banner */}
                    {parsedInvoice.summary && (
                      <div className="p-4 bg-[#F3F4F6] rounded-xl border-l-4 border-[#FA4F01]">
                        <p className="text-sm text-[#374151] italic">"{parsedInvoice.summary}"</p>
                      </div>
                    )}

                    {/* Invoice Summary Header */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                      <div className="p-4 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280] mb-1">Invoice #</p>
                        <p className="text-lg font-bold text-[#111827]">{parsedInvoice.invoiceNumber || "N/A"}</p>
                      </div>
                      <div className="p-4 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280] mb-1">PO #</p>
                        <p className="text-lg font-bold text-[#111827]">{parsedInvoice.poNumber || "N/A"}</p>
                      </div>
                      <div className="p-4 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280] mb-1">Date</p>
                        <p className="text-lg font-bold text-[#111827]">{parsedInvoice.date || "N/A"}</p>
                      </div>
                      <div className="p-4 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280] mb-1">Due Date</p>
                        <p className="text-lg font-bold text-[#111827]">{parsedInvoice.dueDate || "N/A"}</p>
                      </div>
                      <div className="p-4 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280] mb-1">Terms</p>
                        <p className="text-lg font-bold text-[#111827]">{parsedInvoice.paymentTerms || "N/A"}</p>
                      </div>
                      <div className="p-4 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280] mb-1">Province</p>
                        <p className="text-lg font-bold text-[#111827]">{parsedInvoice.province || "N/A"}</p>
                      </div>
                      <div className="p-4 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280] mb-1">Subtotal</p>
                        <p className="text-lg font-bold text-[#111827]">
                          {parsedInvoice.currency || ""} {parsedInvoice.subtotal?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                        </p>
                      </div>
                      <div className="p-4 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280] mb-1">Total</p>
                        <p className="text-lg font-bold text-[#111827]">
                          {parsedInvoice.currency || ""} {parsedInvoice.total?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                        </p>
                      </div>
                    </div>

                    {/* Tax Exemption Rules Reference */}
                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 flex gap-3 items-start">
                      <Brain className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-blue-900">Canadian Tax Exemption Logic Applied</p>
                        <p className="text-xs text-blue-700 leading-relaxed">
                          Line items are evaluated against Canadian tax rules (Basic Groceries, Prescription Drugs, Medical Devices, Feminine Hygiene, Exports, etc.). 
                          <a href="https://accplus.ca/knowledge-base/personal-tax/tax-in-canada-things-that-are-not-taxed/" target="_blank" rel="noopener noreferrer" className="ml-1 underline font-medium hover:text-blue-900">Learn more about what's not taxed in Canada.</a>
                        </p>
                      </div>
                    </div>

                    {/* Tax Identification Numbers Section */}
                    {parsedInvoice.vendorTaxNumbers && (
                      <div className="p-6 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm">
                        <h4 className="text-sm font-bold uppercase tracking-widest text-[#111827] mb-4 flex items-center gap-2">
                          <Table className="w-4 h-4 text-[#FA4F01]" />
                          Tax Identification Numbers
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                          <div className="space-y-1">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280]">Business Number (BN)</p>
                            <p className="text-sm font-bold text-[#111827] font-mono">{parsedInvoice.vendorTaxNumbers.businessNumber || "Not Found"}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280]">GST/HST Registration</p>
                            <p className="text-sm font-bold text-[#111827] font-mono">{parsedInvoice.vendorTaxNumbers.gstHst || "Not Found"}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280]">QST Registration (QC)</p>
                            <p className="text-sm font-bold text-[#111827] font-mono">{parsedInvoice.vendorTaxNumbers.qst || "Not Found"}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B7280]">PST/RST Registration</p>
                            <p className="text-sm font-bold text-[#111827] font-mono">
                              {parsedInvoice.vendorTaxNumbers.pst || parsedInvoice.vendorTaxNumbers.rst || "Not Found"}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tax Verification Section */}
                    {expectedTaxData && (
                      <div className={`p-6 rounded-2xl border ${taxDiscrepancy ? "bg-[#FFF5F2] border-[#FA4F01]/20" : "bg-[#F0FDF4] border-[#166534]/20"}`}>
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-sm font-bold uppercase tracking-widest text-[#111827] flex items-center gap-2">
                            <Brain className={`w-4 h-4 ${taxDiscrepancy ? "text-[#FA4F01]" : "text-[#166534]"}`} />
                            Canadian Tax Verification
                          </h4>
                          {taxDiscrepancy ? (
                            <span className="px-2 py-1 bg-[#FA4F01] text-white text-[10px] font-bold rounded uppercase tracking-wider">Discrepancy Detected</span>
                          ) : (
                            <span className="px-2 py-1 bg-[#166534] text-white text-[10px] font-bold rounded uppercase tracking-wider">Verified</span>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="space-y-1">
                            <p className="text-xs text-[#6B7280]">Detected Province</p>
                            <p className="font-bold text-[#111827]">{expectedTaxData.rates.name} ({expectedTaxData.provinceCode})</p>
                            <p className="text-[10px] text-[#6B7280]">Taxable Base: {parsedInvoice.currency} {expectedTaxData.taxableSubtotal.toFixed(2)}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-[#6B7280]">Expected Tax ({ (expectedTaxData.rates.total * 100).toFixed(2) }%)</p>
                            <p className="font-bold text-[#111827]">{parsedInvoice.currency} {expectedTaxData.total.toFixed(2)}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(expectedTaxData.breakdown).map(([type, amt]) => amt > 0 ? (
                                <span key={type} className="text-[9px] bg-white px-1 py-0.5 rounded border border-[#E5E7EB] text-[#6B7280]">
                                  {type.toUpperCase()}: {amt.toFixed(2)}
                                </span>
                              ) : null)}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-[#6B7280]">Extracted Tax</p>
                            <p className={`font-bold ${taxDiscrepancy ? "text-[#FA4F01]" : "text-[#111827]"}`}>
                              {parsedInvoice.currency} {parsedInvoice.tax?.toFixed(2) || "0.00"}
                            </p>
                            {parsedInvoice.taxBreakdown && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {Object.entries(parsedInvoice.taxBreakdown).map(([type, amt]) => amt ? (
                                  <span key={type} className="text-[9px] bg-white px-1 py-0.5 rounded border border-[#E5E7EB] text-[#6B7280]">
                                    {type.toUpperCase()}: {(amt as number).toFixed(2)}
                                  </span>
                                ) : null)}
                              </div>
                            )}
                          </div>
                        </div>

                        {taxDiscrepancy && (
                          <div className="mt-4 p-3 bg-white/50 rounded-lg border border-[#FA4F01]/10 text-xs text-[#FA4F01] flex gap-2 items-start">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <p>
                              The extracted tax does not match the expected rate for {expectedTaxData.rates.name}. 
                              This could be due to <a href="https://accplus.ca/knowledge-base/personal-tax/tax-in-canada-things-that-are-not-taxed/" target="_blank" rel="noopener noreferrer" className="underline font-medium">tax-exempt items</a>, partial tax application, or extraction error.
                              Expected: {expectedTaxData.total.toFixed(2)}, Found: {parsedInvoice.tax?.toFixed(2)}.
                            </p>
                          </div>
                        )}

                        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
                          {expectedTaxData.rates.gst && (
                            <div className="text-[10px] bg-white px-2 py-1 rounded border border-[#E5E7EB]">
                              <span className="text-[#6B7280]">GST:</span> <span className="font-bold">{(expectedTaxData.rates.gst * 100)}%</span>
                            </div>
                          )}
                          {expectedTaxData.rates.pst && (
                            <div className="text-[10px] bg-white px-2 py-1 rounded border border-[#E5E7EB]">
                              <span className="text-[#6B7280]">PST:</span> <span className="font-bold">{(expectedTaxData.rates.pst * 100)}%</span>
                            </div>
                          )}
                          {expectedTaxData.rates.hst && (
                            <div className="text-[10px] bg-white px-2 py-1 rounded border border-[#E5E7EB]">
                              <span className="text-[#6B7280]">HST:</span> <span className="font-bold">{(expectedTaxData.rates.hst * 100)}%</span>
                            </div>
                          )}
                          {expectedTaxData.rates.qst && (
                            <div className="text-[10px] bg-white px-2 py-1 rounded border border-[#E5E7EB]">
                              <span className="text-[#6B7280]">QST:</span> <span className="font-bold">{(expectedTaxData.rates.qst * 100)}%</span>
                            </div>
                          )}
                          {expectedTaxData.rates.rst && (
                            <div className="text-[10px] bg-white px-2 py-1 rounded border border-[#E5E7EB]">
                              <span className="text-[#6B7280]">RST:</span> <span className="font-bold">{(expectedTaxData.rates.rst * 100)}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Details Section */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-[#9CA3AF] flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#FA4F01]"></div>
                          Vendor Details
                        </h4>
                        <div className="space-y-1">
                          <p className="font-bold text-[#111827]">{parsedInvoice.vendorName || "Not found"}</p>
                          <p className="text-sm text-[#6B7280] whitespace-pre-wrap">{parsedInvoice.vendorAddress || "No address found"}</p>
                          {(parsedInvoice.vendorTaxNumbers?.gstHst || parsedInvoice.vendorTaxNumbers?.pst || parsedInvoice.vendorTaxNumbers?.qst || parsedInvoice.vendorTaxNumbers?.rst) && (
                            <div className="mt-2 pt-2 border-t border-[#E5E7EB] grid grid-cols-1 gap-1">
                              {parsedInvoice.vendorTaxNumbers?.gstHst && (
                                <p className="text-[10px] text-[#374151]"><span className="font-bold uppercase text-[#9CA3AF]">GST/HST:</span> {parsedInvoice.vendorTaxNumbers.gstHst}</p>
                              )}
                              {parsedInvoice.vendorTaxNumbers?.pst && (
                                <p className="text-[10px] text-[#374151]"><span className="font-bold uppercase text-[#9CA3AF]">PST:</span> {parsedInvoice.vendorTaxNumbers.pst}</p>
                              )}
                              {parsedInvoice.vendorTaxNumbers?.qst && (
                                <p className="text-[10px] text-[#374151]"><span className="font-bold uppercase text-[#9CA3AF]">QST:</span> {parsedInvoice.vendorTaxNumbers.qst}</p>
                              )}
                              {parsedInvoice.vendorTaxNumbers?.rst && (
                                <p className="text-[10px] text-[#374151]"><span className="font-bold uppercase text-[#9CA3AF]">RST:</span> {parsedInvoice.vendorTaxNumbers.rst}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-[#9CA3AF] flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#FA4F01]"></div>
                          Customer Details
                        </h4>
                        <div className="space-y-1">
                          <p className="font-bold text-[#111827]">{parsedInvoice.customerName || "Not found"}</p>
                          <p className="text-sm text-[#6B7280] whitespace-pre-wrap">{parsedInvoice.customerAddress || "No address found"}</p>
                          {parsedInvoice.paymentTerms && (
                            <div className="mt-2 pt-2 border-t border-[#E5E7EB]">
                              <p className="text-[10px] uppercase font-bold text-[#9CA3AF]">Terms</p>
                              <p className="text-xs text-[#374151]">{parsedInvoice.paymentTerms}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Line Items Table */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-[#9CA3AF] flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#FA4F01]"></div>
                        Line Items
                      </h4>
                      <div className="border border-[#E5E7EB] rounded-xl overflow-hidden">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                            <tr>
                              <th className="px-4 py-3 font-bold text-[#111827]">Description</th>
                              <th className="px-4 py-3 font-bold text-[#111827] text-right">Qty</th>
                              <th className="px-4 py-3 font-bold text-[#111827] text-right">Price</th>
                              <th className="px-4 py-3 font-bold text-[#111827] text-right">Amount</th>
                              <th className="px-4 py-3 font-bold text-[#111827] text-center">Tax Details</th>
                              <th className="px-4 py-3 font-bold text-[#111827] text-center">Tax Exempt</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E5E7EB]">
                            {parsedInvoice.items?.map((item, idx) => (
                              <tr key={idx} className="hover:bg-[#F9FAFB] transition-colors">
                                <td className="px-4 py-3 text-[#374151]">{item.description}</td>
                                <td className="px-4 py-3 text-[#374151] text-right">{item.quantity || "-"}</td>
                                <td className="px-4 py-3 text-[#374151] text-right">{item.unitPrice?.toFixed(2) || "-"}</td>
                                <td className="px-4 py-3 font-medium text-[#111827] text-right">{item.amount?.toFixed(2) || "-"}</td>
                                <td className="px-4 py-3 text-center">
                                  {item.taxBreakdown || item.taxRate ? (
                                    <div className="flex flex-col items-center gap-1">
                                      {item.taxRate !== undefined && (
                                        <span className="text-[10px] font-bold text-[#111827]">
                                          {(item.taxRate * 100).toFixed(1)}%
                                        </span>
                                      )}
                                      <div className="flex flex-wrap justify-center gap-1">
                                        {item.taxBreakdown?.gst && <span className="text-[9px] bg-[#E2E8F0] px-1 rounded">GST</span>}
                                        {item.taxBreakdown?.pst && <span className="text-[9px] bg-[#E2E8F0] px-1 rounded">PST</span>}
                                        {item.taxBreakdown?.hst && <span className="text-[9px] bg-[#E2E8F0] px-1 rounded">HST</span>}
                                        {item.taxBreakdown?.qst && <span className="text-[9px] bg-[#E2E8F0] px-1 rounded">QST</span>}
                                        {item.taxBreakdown?.rst && <span className="text-[9px] bg-[#E2E8F0] px-1 rounded">RST</span>}
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-[#E5E7EB]">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {item.isTaxExempt ? (
                                    <span className="text-[10px] bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full font-bold uppercase">Exempt</span>
                                  ) : (
                                    <span className="text-[10px] text-[#E5E7EB]">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {(!parsedInvoice.items || parsedInvoice.items.length === 0) && (
                              <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-[#9CA3AF] italic">No line items detected</td>
                              </tr>
                            )}
                          </tbody>
                          <tfoot className="bg-[#F9FAFB] border-t border-[#E5E7EB]">
                            <tr>
                              <td colSpan={5} className="px-4 py-2 text-right font-medium text-[#6B7280]">Subtotal</td>
                              <td className="px-4 py-2 text-right font-medium text-[#111827]">{parsedInvoice.subtotal?.toFixed(2) || "0.00"}</td>
                            </tr>
                            <tr>
                              <td colSpan={5} className="px-4 py-2 text-right font-medium text-[#6B7280]">Tax</td>
                              <td className="px-4 py-2 text-right font-medium text-[#111827]">{parsedInvoice.tax?.toFixed(2) || "0.00"}</td>
                            </tr>
                            <tr className="bg-[#111827] text-white">
                              <td colSpan={5} className="px-4 py-3 text-right font-bold uppercase tracking-wider text-xs">Total Amount</td>
                              <td className="px-4 py-3 text-right font-bold text-lg">
                                {parsedInvoice.currency || ""} {parsedInvoice.total?.toFixed(2) || "0.00"}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </motion.div>
                )}

                {viewMode === "parsed" && parsedInvoice && (
                  <motion.pre
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[#374151] whitespace-pre-wrap font-mono text-xs bg-[#F9FAFB] p-4 rounded-xl border border-[#E5E7EB]"
                  >
                    {JSON.stringify(parsedInvoice, null, 2)}
                  </motion.pre>
                )}

                {viewMode === "raw" && rawResult && (
                  <motion.pre
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[#374151] whitespace-pre-wrap font-mono text-xs bg-[#F9FAFB] p-4 rounded-xl border border-[#E5E7EB]"
                  >
                    {JSON.stringify(rawResult, null, 2)}
                  </motion.pre>
                )}
              </>
            )}
          </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
