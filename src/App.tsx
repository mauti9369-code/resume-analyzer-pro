/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';
import { FileText, Upload, Loader2, CheckCircle2, AlertCircle, Sparkles, Download, Briefcase, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import ReactMarkdown from 'react-markdown';

// Set up pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface AnalysisResult {
  score: number;
  improvements: string[];
  bulletPoints: string[];
}

interface MatchResult {
  score: number;
  missingKeywords: string[];
  suggestions: string[];
}

/**
 * UPDATED PYTHON EQUIVALENT (Streamlit):
 * 
 * import streamlit as st
 * import PyPDF2
 * from openai import OpenAI
 * 
 * client = OpenAI(api_key="YOUR_OPENAI_API_KEY")
 * 
 * def extract_text_from_pdf(file):
 *     reader = PyPDF2.PdfReader(file)
 *     text = ""
 *     for page in reader.pages:
 *         text += page.extract_text() or ""
 *     return text
 * 
 * st.title("🚀 Simple AI Resume Analyzer")
 * 
 * uploaded_file = st.file_uploader("Upload Resume (PDF)", type="pdf")
 * job_description = st.text_area("Paste Job Description (Optional)")
 * 
 * if uploaded_file:
 *     resume_text = extract_text_from_pdf(uploaded_file)
 *     
 *     col1, col2 = st.columns(2)
 *     
 *     with col1:
 *         if st.button("Analyze Resume"):
 *             # AI Call for Analysis
 *             pass
 *             
 *     with col2:
 *         if st.button("Improve Resume"):
 *             # AI Call for Improvement
 *             prompt = f"""
 *             Rewrite the resume in a clean, professional format.
 *             Resume: {resume_text}
 *             OUTPUT FORMAT (STRICT):
 *             # Name
 *             ## Summary
 *             - 2–3 lines professional summary
 *             ## Skills
 *             - Bullet points
 *             ## Experience
 *             - Role
 *               - Bullet points with strong action verbs
 *             ## Projects
 *             - Project name
 *               - Bullet points
 *             ## Education
 *             - Degree, institution
 *             ---
 *             RULES:
 *             - Use proper headings
 *             - Use bullet points
 *             - Keep it clean and readable
 *             - Make it ATS-friendly
 *             - DO NOT return plain paragraphs
 *             """
 *             pass
 * 
 *     if st.button("Download Report"):
 *         # Generate .txt file
 *         pass
 */

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [improvedResume, setImprovedResume] = useState<string | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<'analyze' | 'improve' | null>(null);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Timeout warning logic
  useEffect(() => {
    let timer: any;
    if (isAnalyzing || isImproving) {
      timer = setTimeout(() => {
        setShowTimeoutWarning(true);
      }, 12000);
    } else {
      setShowTimeoutWarning(false);
    }
    return () => clearTimeout(timer);
  }, [isAnalyzing, isImproving]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    processFile(selectedFile);
  };

  const processFile = (selectedFile: File | undefined) => {
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError(null);
      resetResults();
    } else if (selectedFile) {
      setError('Please upload a valid PDF file.');
      setFile(null);
    }
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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const resetResults = () => {
    setAnalysisResult(null);
    setMatchResult(null);
    setImprovedResume(null);
    setError(null);
    setRetryMessage(null);
  };

  const extractText = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    
    return fullText.trim();
  };

  const callGeminiWithRetry = async (fn: () => Promise<any>, retries = 3, delay = 2500) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        const errorMessage = err.message?.toLowerCase() || '';
        const isOverloaded = errorMessage.includes('overloaded') || 
                            errorMessage.includes('high demand') || 
                            errorMessage.includes('503') ||
                            errorMessage.includes('429');
        
        if (isOverloaded && i < retries - 1) {
          setRetryMessage(`Server is busy right now. Retrying (Attempt ${i + 1}/${retries})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      }
    }
  };

  const runAnalysis = async () => {
    if (!file) return;
    setIsAnalyzing(true);
    setError(null);
    setRetryMessage(null);
    setLastAction('analyze');

    try {
      const text = await extractText(file);
      if (!text) throw new Error('Could not extract text from this PDF. Please ensure it is a text-based PDF.');

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const performAnalysis = async () => {
        const analysisPromise = ai.models.generateContent({
          model: "gemini-flash-latest",
          contents: `You are a resume expert. Analyze this resume text and provide a JSON response.
          Resume Text: ${text}
          Provide: 1. Score out of 100, 2. 3-5 clear improvements, 3. 2 improved bullet points.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                score: { type: Type.NUMBER },
                improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
                bulletPoints: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["score", "improvements", "bulletPoints"]
            }
          }
        });

        let matchPromise = null;
        if (jobDescription.trim()) {
          matchPromise = ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: `Compare the resume and job description.
            Resume: ${text}
            Job Description: ${jobDescription}
            Output a JSON with: 1. Match score (%), 2. Missing keywords, 3. Suggestions to improve match.`,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  score: { type: Type.NUMBER },
                  missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                  suggestions: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["score", "missingKeywords", "suggestions"]
              }
            }
          });
        }

        return await Promise.all([analysisPromise, matchPromise]);
      };

      const [analysisRes, matchRes] = await callGeminiWithRetry(performAnalysis);

      setAnalysisResult(JSON.parse(analysisRes.text));
      if (matchRes) setMatchResult(JSON.parse(matchRes.text));

    } catch (err: any) {
      const msg = err.message?.toLowerCase() || '';
      if (msg.includes('overloaded') || msg.includes('high demand')) {
        setError('The AI server is currently experiencing high demand. Please try again in a few seconds.');
      } else {
        setError('An error occurred during analysis. Please check your file and try again.');
      }
    } finally {
      setIsAnalyzing(false);
      setRetryMessage(null);
    }
  };

  const improveResume = async () => {
    if (!file) return;
    setIsImproving(true);
    setError(null);
    setRetryMessage(null);
    setLastAction('improve');

    try {
      const text = await extractText(file);
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const performImprovement = () => ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: `Rewrite the resume in a clean, professional format.

Resume:
${text}

OUTPUT FORMAT (STRICT):

# Name

## Summary
- 2–3 lines professional summary

## Skills
- Bullet points

## Experience
- Role
  - Bullet points with strong action verbs

## Projects
- Project name
  - Bullet points

## Education
- Degree, institution

---

RULES:
- Use proper headings
- Use bullet points
- Keep it clean and readable
- Make it ATS-friendly
- DO NOT return plain paragraphs`
      });

      const response = await callGeminiWithRetry(performImprovement);
      setImprovedResume(response.text);
    } catch (err: any) {
      const msg = err.message?.toLowerCase() || '';
      if (msg.includes('overloaded') || msg.includes('high demand')) {
        setError('The AI server is currently experiencing high demand. Please try again in a few seconds.');
      } else {
        setError('An error occurred while improving the resume. Please try again.');
      }
    } finally {
      setIsImproving(false);
      setRetryMessage(null);
    }
  };

  const downloadReport = () => {
    let content = `AI RESUME ANALYSIS REPORT\n`;
    content += `==========================\n\n`;

    if (analysisResult) {
      content += `RESUME SCORE: ${analysisResult.score}/100\n\n`;
      content += `IMPROVEMENTS:\n`;
      analysisResult.improvements.forEach((imp, i) => content += `${i+1}. ${imp}\n`);
      content += `\nIMPROVED BULLET POINTS:\n`;
      analysisResult.bulletPoints.forEach((bp, i) => content += `- ${bp}\n`);
      content += `\n`;
    }

    if (matchResult) {
      content += `JOB MATCH ANALYSIS\n`;
      content += `------------------\n`;
      content += `MATCH SCORE: ${matchResult.score}%\n\n`;
      content += `MISSING KEYWORDS:\n`;
      matchResult.missingKeywords.forEach((kw) => content += `- ${kw}\n`);
      content += `\nSUGGESTIONS FOR MATCH:\n`;
      matchResult.suggestions.forEach((sug) => content += `- ${sug}\n`);
      content += `\n`;
    }

    if (improvedResume) {
      content += `IMPROVED RESUME VERSION\n`;
      content += `-----------------------\n`;
      content += improvedResume;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Resume_Analysis_Report.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827] font-sans selection:bg-blue-100">
      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-1.5 rounded-lg">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg sm:text-xl font-bold tracking-tight text-gray-900">AI Resume Analyzer</span>
            </div>
            <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-500">
              <a href="#" className="hover:text-blue-600 transition-colors">How it works</a>
              <button className="bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-all">Get Started</button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <div className="text-center mb-10 sm:mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl sm:text-5xl font-extrabold text-gray-900 mb-4 tracking-tight px-2"
          >
            Optimize your resume for <span className="text-blue-600">ATS and job matching</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-base sm:text-lg text-gray-600 max-w-2xl mx-auto px-4"
          >
            Upload your resume and get instant AI-powered feedback, keyword optimization, and professional rewriting suggestions.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
          {/* Input Section */}
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-8">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" />
                Step 1: Upload Resume
              </h3>
              
              <div 
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative border-2 border-dashed rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-200
                  ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}
                  ${file ? 'border-green-500 bg-green-50/30' : ''}
                `}
              >
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf" className="hidden" />
                <div className="flex flex-col items-center gap-3">
                  <div className={`p-3 rounded-full ${file ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                    {file ? <CheckCircle2 className="w-6 h-6" /> : <Upload className="w-6 h-6" />}
                  </div>
                  <div className="max-w-full overflow-hidden">
                    <p className="text-sm font-semibold text-gray-900 truncate px-2">
                      {file ? file.name : 'Select PDF Resume'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      PDF files only • Max 5MB
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-blue-600" />
                  Step 2: Job Description <span className="text-xs font-normal text-gray-400 ml-1">(Optional)</span>
                </h3>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the job description here to check for matching keywords and alignment..."
                  className="w-full h-40 sm:h-48 p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none placeholder:text-gray-400"
                />
              </div>

              <div className="mt-8 space-y-3">
                <button
                  onClick={runAnalysis}
                  disabled={!file || isAnalyzing || isImproving}
                  className="w-full py-3.5 sm:py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-600/10"
                >
                  {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                  {isAnalyzing ? 'Analyzing...' : 'Analyze Resume'}
                </button>
                
                <button
                  onClick={improveResume}
                  disabled={!file || isImproving || isAnalyzing}
                  className="w-full py-3.5 sm:py-4 bg-white text-gray-900 border border-gray-200 rounded-xl font-bold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                >
                  {isImproving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5 text-purple-600" />}
                  {isImproving ? 'Improving...' : 'Improve Resume'}
                </button>

                {(analysisResult || matchResult || improvedResume) && (
                  <button
                    onClick={downloadReport}
                    className="w-full py-3 text-blue-600 font-bold hover:underline flex items-center justify-center gap-2 transition-all text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download Full Report (.txt)
                  </button>
                )}
              </div>

              <AnimatePresence>
                {(error || retryMessage) && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`mt-6 p-4 rounded-xl text-sm flex flex-col gap-3 ${retryMessage ? 'bg-blue-50 border border-blue-100 text-blue-700' : 'bg-red-50 border border-red-100 text-red-700'}`}
                  >
                    <div className="flex items-start gap-3">
                      {retryMessage ? <Loader2 className="w-5 h-5 shrink-0 animate-spin" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                      <p>{retryMessage || error}</p>
                    </div>
                    {error && (
                      <button 
                        onClick={() => lastAction === 'improve' ? improveResume() : runAnalysis()}
                        className="self-end text-xs font-bold underline hover:no-underline"
                      >
                        Try Again
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>

          {/* Results Area */}
          <div className="lg:col-span-7 space-y-6 sm:space-y-8">
            <AnimatePresence mode="wait">
              {isAnalyzing || isImproving ? (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="bg-white rounded-2xl border border-gray-200 p-8 sm:p-12 flex flex-col items-center justify-center text-center min-h-[350px] sm:min-h-[400px]"
                >
                  <div className="relative mb-6">
                    <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Sparkles className="w-6 h-6 text-blue-600 animate-pulse" />
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    {isAnalyzing ? 'Analyzing your resume, please wait...' : 'Rewriting for impact, please wait...'}
                  </h3>
                  <p className="text-gray-500 text-sm sm:text-base">Our AI is processing your content to provide the best insights.</p>
                  
                  {showTimeoutWarning && (
                    <motion.p 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-4 text-orange-600 text-xs font-medium bg-orange-50 px-3 py-1 rounded-full"
                    >
                      This is taking longer than usual, please wait or try again
                    </motion.p>
                  )}
                </motion.div>
              ) : (analysisResult || matchResult || improvedResume) ? (
                <motion.div 
                  key="results"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6 sm:space-y-8"
                >
                  {/* Resume Analysis Section */}
                  {analysisResult && (
                    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                      <div className="bg-gray-50 px-6 sm:px-8 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-gray-900">
                          <CheckCircle2 className="w-5 h-5 text-green-500" />
                          Resume Analysis
                        </h2>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-500">Score:</span>
                          <span className={`text-lg font-bold ${analysisResult.score > 70 ? 'text-green-600' : 'text-orange-500'}`}>
                            {analysisResult.score}/100
                          </span>
                        </div>
                      </div>
                      
                      <div className="p-6 sm:p-8 space-y-8">
                        <div>
                          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Top Improvements</h3>
                          <div className="grid grid-cols-1 gap-3">
                            {analysisResult.improvements.map((imp, i) => (
                              <div key={i} className="flex items-start gap-3 p-4 bg-blue-50/50 rounded-xl border border-blue-100/50 text-sm text-gray-700">
                                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 font-bold text-xs">
                                  {i + 1}
                                </div>
                                <span className="leading-relaxed">{imp}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Impactful Bullet Points</h3>
                          <div className="space-y-4">
                            {analysisResult.bulletPoints.map((bp, i) => (
                              <div key={i} className="p-5 bg-green-50/30 rounded-xl border-l-4 border-green-500 text-sm italic text-gray-700 leading-relaxed">
                                "{bp}"
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Job Match Section */}
                  {matchResult && (
                    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                      <div className="bg-gray-50 px-6 sm:px-8 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-gray-900">
                          <Briefcase className="w-5 h-5 text-blue-500" />
                          Job Match Analysis
                        </h2>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-500">Match:</span>
                          <span className="text-lg font-bold text-blue-600">{matchResult.score}%</span>
                        </div>
                      </div>

                      <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-10">
                        <div>
                          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Missing Keywords</h3>
                          <div className="flex flex-wrap gap-2">
                            {matchResult.missingKeywords.map((kw, i) => (
                              <span key={i} className="px-3 py-1.5 bg-red-50 text-red-600 rounded-full text-xs font-bold border border-red-100">
                                {kw}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Alignment Tips</h3>
                          <ul className="space-y-3">
                            {matchResult.suggestions.map((sug, i) => (
                              <li key={i} className="text-sm flex items-start gap-3 text-gray-700">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0"></div>
                                <span className="leading-relaxed">{sug}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Improved Resume Section */}
                  {improvedResume && (
                    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                      <div className="bg-gray-50 px-6 sm:px-8 py-4 border-b border-gray-200">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-gray-900">
                          <Wand2 className="w-5 h-5 text-purple-500" />
                          Optimized Resume Version
                        </h2>
                      </div>
                      <div className="p-5 sm:p-8">
                        <div className="prose prose-sm sm:prose-blue max-w-none bg-gray-50/50 p-5 sm:p-8 rounded-2xl border border-gray-100 leading-relaxed text-gray-800 overflow-x-auto">
                          <ReactMarkdown>{improvedResume}</ReactMarkdown>
                        </div>
                      </div>
                    </section>
                  )}
                </motion.div>
              ) : (
                <motion.div 
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white rounded-2xl border border-gray-200 border-dashed p-12 sm:p-20 flex flex-col items-center justify-center text-center min-h-[400px] sm:min-h-[500px]"
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6">
                    <FileText className="w-8 h-8 sm:w-10 sm:h-10 text-gray-300" />
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">Ready to optimize?</h3>
                  <p className="text-gray-500 max-w-xs text-sm sm:text-base">Upload your resume on the left to start your professional analysis.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-4 py-8 sm:py-12 border-t border-gray-200 text-center">
        <p className="text-xs sm:text-sm text-gray-400">© 2026 AI Resume Analyzer • Powered by Gemini AI • Privacy First</p>
      </footer>
    </div>
  );
}
