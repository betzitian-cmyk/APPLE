import React from 'react';
import { BarChart3, PieChart, TrendingUp, AlertCircle } from 'lucide-react';
import { BatchReport as BatchReportType } from '../types';

interface BatchReportProps {
  report: BatchReportType;
}

export const BatchReport: React.FC<BatchReportProps> = ({ report }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
      <div className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-blue-100 rounded-lg">
            <BarChart3 className="w-5 h-5 text-blue-600" />
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Files</span>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-bold text-gray-900">{report.totalFiles}</span>
          <span className="text-sm text-gray-500 mt-1">Uploaded for processing</span>
        </div>
      </div>

      <div className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Processed</span>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-bold text-green-600">{report.processedFiles}</span>
          <span className="text-sm text-gray-500 mt-1">Successfully extracted</span>
        </div>
      </div>

      <div className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-red-100 rounded-lg">
            <AlertCircle className="w-5 h-5 text-red-600" />
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Errors</span>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-bold text-red-600">{report.errorFiles}</span>
          <span className="text-sm text-gray-500 mt-1">Failed to process</span>
        </div>
      </div>

      <div className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-purple-100 rounded-lg">
            <PieChart className="w-5 h-5 text-purple-600" />
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Value</span>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-bold text-gray-900">
            {report.totalAmount.toLocaleString()}
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(report.currencyBreakdown).map(([curr, amt]) => (
              <span key={curr} className="text-xs font-medium px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">
                {curr}: {amt.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
