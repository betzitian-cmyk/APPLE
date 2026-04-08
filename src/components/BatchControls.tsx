import React from 'react';
import { Play, Download, RotateCcw, Loader2 } from 'lucide-react';
import { ProcessingFile } from '../types';

interface BatchControlsProps {
  files: ProcessingFile[];
  onStart: () => void;
  onReset: () => void;
  onDownloadCsv: () => void;
  isProcessing: boolean;
}

export const BatchControls: React.FC<BatchControlsProps> = ({
  files,
  onStart,
  onReset,
  onDownloadCsv,
  isProcessing
}) => {
  const hasFiles = files.length > 0;
  const allCompleted = hasFiles && files.every(f => f.status === 'completed' || f.status === 'error');
  const hasResults = files.some(f => f.status === 'completed');

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-6 bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Batch Status</span>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-2xl font-bold text-gray-900">{files.length}</span>
          <span className="text-gray-400 font-medium">Files in Queue</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {hasFiles && !allCompleted && !isProcessing && (
          <button
            onClick={onStart}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all shadow-md hover:shadow-lg active:scale-95"
          >
            <Play className="w-4 h-4" />
            Start Processing
          </button>
        )}

        {isProcessing && (
          <div className="flex items-center gap-2 px-6 py-2.5 bg-blue-50 text-blue-600 font-semibold rounded-lg border border-blue-200">
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing Batch...
          </div>
        )}

        {allCompleted && (
          <>
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Clear Batch
            </button>
            {hasResults && (
              <button
                onClick={onDownloadCsv}
                className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-all shadow-md hover:shadow-lg active:scale-95"
              >
                <Download className="w-4 h-4" />
                Download Consolidated CSV
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
