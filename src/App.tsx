/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError(null);
      resetResults();
    } else if (selectedFile) {
      setError('Please upload a PDF file.');
      setFile(null);
    }
  };

  const resetResults = () => {
    setAnalysisResult(null);
    setMatchResult(null);
    setImprovedResume(null);
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

  const runAnalysis = async () => {
    if (!file) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const text = await extractText(file);
      if (!text) throw new Error('This PDF is not supported. Please upload a text-based resume.');

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      // 1. Basic Analysis
      const analysisPromise = ai.models.generateContent({
        model: "gemini-3-flash-preview",
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

      // 2. Job Match (if JD provided)
      let matchPromise = null;
      if (jobDescription.trim()) {
        matchPromise = ai.models.generateContent({
          model: "gemini-3-flash-preview",
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

      const [analysisRes, matchRes] = await Promise.all([
        analysisPromise,
        matchPromise
      ]);

      setAnalysisResult(JSON.parse(analysisRes.text));
      if (matchRes) setMatchResult(JSON.parse(matchRes.text));

    } catch (err: any) {
      setError(err.message || 'An error occurred during analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const improveResume = async () => {
    if (!file) return;
    setIsImproving(true);
    setError(null);

    try {
      const text = await extractText(file);
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
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

      setImprovedResume(response.text);
    } catch (err: any) {
      setError(err.message || 'An error occurred while improving the resume.');
    } finally {
      setIsImproving(false);
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
    <div className="min-h-screen bg-[#F0F2F6] text-[#31333F] font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-4xl font-bold flex items-center gap-3">
            🚀 Simple AI Resume Analyzer
          </h1>
          <p className="text-lg opacity-80 mt-2">
            Professional resume analysis and job matching tool
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Sidebar / Controls */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E0E0E0]">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload
              </h2>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
                  ${file ? 'border-green-500 bg-green-50' : 'border-[#DEE2E6] hover:border-blue-500'}
                `}
              >
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf" className="hidden" />
                <Upload className={`w-8 h-8 mx-auto mb-2 ${file ? 'text-green-500' : 'text-gray-400'}`} />
                <p className="text-sm font-medium truncate">
                  {file ? file.name : 'Choose PDF file'}
                </p>
              </div>

              <div className="mt-6">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Briefcase className="w-5 h-5" />
                  Job Description
                </h2>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the job description here to check for matching..."
                  className="w-full h-40 p-3 bg-[#F8F9FB] border border-[#DEE2E6] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                />
              </div>

              <div className="mt-6 space-y-3">
                <button
                  onClick={runAnalysis}
                  disabled={!file || isAnalyzing}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                >
                  {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Analyze Resume
                </button>
                
                <button
                  onClick={improveResume}
                  disabled={!file || isImproving}
                  className="w-full py-3 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                >
                  {isImproving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  Improve Resume
                </button>

                {(analysisResult || matchResult || improvedResume) && (
                  <button
                    onClick={downloadReport}
                    className="w-full py-3 border-2 border-blue-600 text-blue-600 rounded-lg font-bold hover:bg-blue-50 flex items-center justify-center gap-2 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Download Report
                  </button>
                )}
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Results Area */}
          <div className="lg:col-span-2 space-y-8">
            <AnimatePresence>
              {/* Resume Analysis Section */}
              {analysisResult && (
                <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-8 rounded-xl shadow-sm border border-[#E0E0E0]">
                  <h2 className="text-2xl font-bold mb-6 border-b pb-2 flex items-center gap-2">
                    <CheckCircle2 className="text-green-500" />
                    Resume Analysis
                  </h2>
                  <div className="flex items-center gap-6 mb-8">
                    <div className="w-24 h-24 rounded-full border-8 border-blue-500 flex items-center justify-center">
                      <span className="text-2xl font-bold">{analysisResult.score}</span>
                    </div>
                    <div>
                      <p className="text-lg font-bold">Overall Score</p>
                      <p className="text-sm text-gray-500">Based on content, formatting, and impact.</p>
                    </div>
                  </div>
                  
                  <div className="space-y-6">
                    <div>
                      <h3 className="font-bold text-blue-600 mb-3 uppercase tracking-wider text-sm">Improvements</h3>
                      <ul className="space-y-2">
                        {analysisResult.improvements.map((imp, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="text-blue-500 font-bold">•</span>
                            {imp}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-green-600 mb-3 uppercase tracking-wider text-sm">Better Bullet Points</h3>
                      <div className="space-y-3">
                        {analysisResult.bulletPoints.map((bp, i) => (
                          <div key={i} className="p-3 bg-gray-50 rounded-lg border-l-4 border-green-500 text-sm italic">
                            "{bp}"
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.section>
              )}

              {/* Job Match Section */}
              {matchResult && (
                <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-8 rounded-xl shadow-sm border border-[#E0E0E0]">
                  <h2 className="text-2xl font-bold mb-6 border-b pb-2 flex items-center gap-2">
                    <Briefcase className="text-blue-500" />
                    Job Match Analysis
                  </h2>
                  <div className="flex items-center gap-6 mb-8">
                    <div className="w-24 h-24 rounded-full border-8 border-green-500 flex items-center justify-center">
                      <span className="text-2xl font-bold">{matchResult.score}%</span>
                    </div>
                    <div>
                      <p className="text-lg font-bold">Match Percentage</p>
                      <p className="text-sm text-gray-500">How well your resume aligns with the JD.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <h3 className="font-bold text-red-500 mb-3 uppercase tracking-wider text-sm">Missing Keywords</h3>
                      <div className="flex flex-wrap gap-2">
                        {matchResult.missingKeywords.map((kw, i) => (
                          <span key={i} className="px-2 py-1 bg-red-50 text-red-600 rounded text-xs font-medium">
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-blue-600 mb-3 uppercase tracking-wider text-sm">Matching Tips</h3>
                      <ul className="space-y-2">
                        {matchResult.suggestions.map((sug, i) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <span className="text-blue-400">→</span>
                            {sug}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </motion.section>
              )}

              {/* Improved Resume Section */}
              {improvedResume && (
                <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-8 rounded-xl shadow-sm border border-[#E0E0E0]">
                  <h2 className="text-2xl font-bold mb-6 border-b pb-2 flex items-center gap-2">
                    <Wand2 className="text-purple-500" />
                    Improved Resume
                  </h2>
                  <div className="prose prose-sm max-w-none bg-gray-50 p-6 rounded-lg border border-gray-200 leading-relaxed">
                    <ReactMarkdown>{improvedResume}</ReactMarkdown>
                  </div>
                </motion.section>
              )}

              {/* Placeholder */}
              {!analysisResult && !matchResult && !improvedResume && !isAnalyzing && !isImproving && (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 py-20">
                  <FileText className="w-16 h-16 mb-4 opacity-20" />
                  <p className="text-lg">Upload a resume and click analyze to see results</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
