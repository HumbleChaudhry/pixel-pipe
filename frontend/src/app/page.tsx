'use client';

import { useState, useEffect, useCallback } from 'react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showDragMode, setShowDragMode] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setUploadStatus({ type: null, message: '' });

    try {
      // Step 1: Get the presigned upload URL
      const urlResponse = await fetch(
        'https://v2l1qr6b47.execute-api.ca-central-1.amazonaws.com/prod/get-upload-url'
      );

      if (!urlResponse.ok) {
        throw new Error('Failed to get upload URL');
      }

      const { uploadURL, key } = await urlResponse.json();

      // Step 2: Upload the file directly to S3
      const uploadResponse = await fetch(uploadURL, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file');
      }

      setUploadStatus({
        type: 'success',
        message: `🎉 Successfully uploaded ${file.name}! File key: ${key}`,
      });

      // Clear the file input after successful upload
      setTimeout(() => {
        setSelectedFile(null);
        const fileInput = document.getElementById(
          'file-input'
        ) as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      }, 2000);
    } catch (error) {
      setUploadStatus({
        type: 'error',
        message: `❌ Upload failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const processFile = useCallback((file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      setUploadStatus({
        type: 'error',
        message: 'Please select an image file',
      });
      return;
    }

    // Reset any previous upload status
    setUploadStatus({ type: null, message: '' });
    setSelectedFile(file);

    // Auto-upload the file
    uploadFile(file);
  }, []);

  // Global drag detection
  useEffect(() => {
    let dragCounter = 0;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer?.types.includes('Files')) {
        setShowDragMode(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        setShowDragMode(false);
        setIsDragOver(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setShowDragMode(false);
      setIsDragOver(false);

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        processFile(file);
      }
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [processFile]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadStatus({
        type: 'error',
        message: 'Please select a file first',
      });
      return;
    }

    await uploadFile(selectedFile);
  };

  // Card drag handlers
  const handleCardDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleCardDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-md mx-auto">
        <div
          className={`bg-white rounded-2xl shadow-xl p-8 transition-all duration-300 ${
            showDragMode
              ? isDragOver
                ? 'border-4 border-indigo-500 bg-indigo-50 scale-105 shadow-2xl'
                : 'border-4 border-dashed border-gray-400 bg-gray-50'
              : ''
          }`}
          onDragOver={showDragMode ? handleCardDragOver : undefined}
          onDragLeave={showDragMode ? handleCardDragLeave : undefined}
        >
          {/* Dynamic Content Based on Drag Mode */}
          {showDragMode ? (
            // Drag Mode Content
            <div className="text-center">
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-200 ${
                  isDragOver ? 'bg-indigo-200' : 'bg-gray-200'
                }`}
              >
                <svg
                  className={`w-10 h-10 transition-colors ${
                    isDragOver ? 'text-indigo-600' : 'text-gray-500'
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <h2
                className={`text-2xl font-bold mb-2 transition-colors ${
                  isDragOver ? 'text-indigo-900' : 'text-gray-700'
                }`}
              >
                {isDragOver ? 'Drop Your Image Here!' : 'Drop to Upload'}
              </h2>
              <p
                className={`text-sm transition-colors ${
                  isDragOver ? 'text-indigo-700' : 'text-gray-500'
                }`}
              >
                {isDragOver
                  ? 'Release to upload your image'
                  : 'Drag your image file here to upload'}
              </p>
            </div>
          ) : (
            // Normal Mode Content
            <>
              {/* Header */}
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg
                    className="w-8 h-8 text-indigo-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  Pixel-Pipe
                </h1>
                <p className="text-gray-600">
                  AI-Powered Media Analysis Platform
                </p>
              </div>

              {/* File Input */}
              <div className="mb-6">
                <label
                  htmlFor="file-input"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Choose Image File
                </label>
                <input
                  id="file-input"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />

                {/* File Preview */}
                {selectedFile && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                        <svg
                          className="w-5 h-5 text-indigo-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {selectedFile.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                      {isUploading && (
                        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Upload Button */}
              <button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading}
                className={`w-full py-3 px-4 rounded-lg font-medium text-white transition-colors ${
                  !selectedFile || isUploading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'
                }`}
              >
                {isUploading ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Uploading...</span>
                  </div>
                ) : (
                  'Upload Image'
                )}
              </button>

              {/* Status Messages */}
              {uploadStatus.message && (
                <div
                  className={`mt-4 p-3 rounded-lg ${
                    uploadStatus.type === 'success'
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <p
                    className={`text-sm ${
                      uploadStatus.type === 'success'
                        ? 'text-green-800'
                        : 'text-red-800'
                    }`}
                  >
                    {uploadStatus.message}
                  </p>
                </div>
              )}

              {/* Footer */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-xs text-gray-500 text-center">
                  Powered by AWS S3 • Secure & Fast Upload
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
