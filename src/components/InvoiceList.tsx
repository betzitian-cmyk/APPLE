import React from 'react';
import { CheckCircle2, AlertCircle, Loader2, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ProcessingFile } from '../types';

interface InvoiceListProps {
  files: ProcessingFile[];
}

export const InvoiceList: React.FC<InvoiceListProps> = ({ files }) => {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (files.length === 0) return null;

  return (
    <div className="mt-8 space-y-4">
      <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
        <FileText className="w-6 h-6 text-blue-600" />
        Processing Queue
      </h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">File Name</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Vendor</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Amount</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {files.map((file) => (
                <React.Fragment key={file.id}>
                  <tr 
                    className={`hover:bg-gray-50 transition-colors cursor-pointer ${expandedId === file.id ? 'bg-blue-50/30' : ''}`}
                    onClick={() => file.result && toggleExpand(file.id)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <FileText className="w-5 h-5 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900 truncate max-w-[200px]">
                          {file.file.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        {file.status === 'queued' && (
                          <div className="flex items-center text-gray-400 text-sm">
                            <div className="w-2 h-2 rounded-full bg-gray-300 mr-2" />
                            Queued
                          </div>
                        )}
                        {file.status === 'processing' && (
                          <div className="flex items-center text-blue-600 text-sm">
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Processing...
                          </div>
                        )}
                        {file.status === 'completed' && (
                          <div className="flex items-center text-green-600 text-sm">
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Completed
                          </div>
                        )}
                        {file.status === 'error' && (
                          <div className="flex items-center text-red-600 text-sm">
                            <AlertCircle className="w-4 h-4 mr-2" />
                            Error
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {file.result?.vendorName || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">
                      {file.result ? `${file.result.totalAmount.toLocaleString()} ${file.result.currency}` : '-'}
                    </td>
                    <td className="px-6 py-4">
                      {file.result && (
                        expandedId === file.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </td>
                  </tr>
                  <AnimatePresence>
                    {expandedId === file.id && file.result && (
                      <tr>
                        <td colSpan={5} className="px-6 py-0">
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="py-6 grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-blue-100">
                              <div className="space-y-4">
                                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Invoice Details</h4>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <p className="text-gray-500">Invoice Number</p>
                                    <p className="font-medium text-gray-900">{file.result.invoiceNumber}</p>
                                  </div>
                                  <div>
                                    <p className="text-gray-500">Date</p>
                                    <p className="font-medium text-gray-900">{file.result.date}</p>
                                  </div>
                                  <div>
                                    <p className="text-gray-500">Tax Amount</p>
                                    <p className="font-medium text-gray-900">{file.result.taxAmount.toLocaleString()} {file.result.currency}</p>
                                  </div>
                                  <div>
                                    <p className="text-gray-500">Total Amount</p>
                                    <p className="font-bold text-blue-600">{file.result.totalAmount.toLocaleString()} {file.result.currency}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="space-y-4">
                                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Line Items</h4>
                                <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-gray-100 border-b border-gray-200">
                                      <tr>
                                        <th className="px-3 py-2 font-semibold text-gray-600">Description</th>
                                        <th className="px-3 py-2 font-semibold text-gray-600 text-right">Qty</th>
                                        <th className="px-3 py-2 font-semibold text-gray-600 text-right">Price</th>
                                        <th className="px-3 py-2 font-semibold text-gray-600 text-right">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                      {file.result.items.map((item, i) => (
                                        <tr key={i}>
                                          <td className="px-3 py-2 text-gray-700">{item.description}</td>
                                          <td className="px-3 py-2 text-gray-700 text-right">{item.quantity}</td>
                                          <td className="px-3 py-2 text-gray-700 text-right">{item.unitPrice.toLocaleString()}</td>
                                          <td className="px-3 py-2 font-medium text-gray-900 text-right">{item.amount.toLocaleString()}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
