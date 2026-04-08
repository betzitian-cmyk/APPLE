export interface InvoiceData {
  invoiceNumber: string;
  date: string;
  vendorName: string;
  totalAmount: number;
  currency: string;
  taxAmount: number;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
}

export interface ProcessingFile {
  id: string;
  file: File;
  status: 'queued' | 'processing' | 'completed' | 'error';
  progress: number;
  result?: InvoiceData;
  error?: string;
}

export interface BatchReport {
  totalFiles: number;
  processedFiles: number;
  errorFiles: number;
  totalAmount: number;
  currencyBreakdown: Record<string, number>;
}
