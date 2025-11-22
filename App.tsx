import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Play, RefreshCw, TrendingUp, Brain, ChevronRight, Info } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Scatter, ScatterChart, ReferenceArea } from 'recharts';
import { Constraint, ConstraintType, LPModel, OptimizationType, SimplexResult } from './types';
import { solveSimplex } from './services/simplexLogic';
import { parseNaturalLanguageProblem, explainSolutionWithGemini } from './services/geminiService';

// --- Helper Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, icon: Icon }: any) => {
  const baseStyle = "inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-accent text-white hover:bg-blue-600 focus:ring-blue-500 shadow-lg shadow-blue-500/30",
    secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 focus:ring-slate-200",
    danger: "text-red-500 hover:bg-red-50 p-2 rounded-full",
    ghost: "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      className={`${baseStyle} ${(variants as any)[variant]} ${className}`}
    >
      {Icon && <Icon className="w-4 h-4 mr-2" />}
      {children}
    </button>
  );
};

const Input = ({ value, onChange, type = "number", className = "", placeholder = "" }: any) => (
  <input
    type={type}
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    className={`block w-full rounded-md border-slate-300 shadow-sm focus:border-accent focus:ring focus:ring-blue-200 focus:ring-opacity-50 bg-white px-3 py-2 text-sm transition-colors ${className}`}
  />
);

// --- Visualization Component ---
// Only visualizes 2 variables
const FeasibleRegion = ({ model, result }: { model: LPModel, result: SimplexResult | null }) => {
  if (model.numVariables !== 2) return null;

  // Generate points for constraints lines
  // x1 * c1 + x2 * c2 = rhs => x2 = (rhs - x1*c1) / c2
  const data = useMemo(() => {
    const points: any[] = [];
    const maxAxis = 100; // Arbitrary range for visualization
    
    // We just plot lines for now. Calculating the polygon intersection is complex for a simple chart lib.
    // We will plot lines and the optimal point.
    
    model.constraints.forEach((c, idx) => {
        const c1 = c.coefficients[0];
        const c2 = c.coefficients[1];
        const rhs = c.rhs;
        
        // Two points to draw a line
        if (c2 !== 0) {
            points.push({
                id: idx,
                x1: 0, y1: rhs/c2,
                x2: maxAxis, y2: (rhs - maxAxis*c1)/c2,
                name: `Constraint ${idx+1}`
            });
        } else if (c1 !== 0) {
            // Vertical line x = rhs/c1
            points.push({
                id: idx,
                x1: rhs/c1, y1: 0,
                x2: rhs/c1, y2: maxAxis,
                name: `Constraint ${idx+1}`
            });
        }
    });
    return points;
  }, [model]);

  return (
    <div className="h-80 w-full bg-white rounded-xl border border-slate-200 p-4 shadow-sm mt-6 relative overflow-hidden">
      <div className="absolute top-4 left-4 z-10 bg-white/80 backdrop-blur p-2 rounded text-xs font-mono text-slate-500">
        2D Projection (Variables 1 & 2)
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" dataKey="x" name="X1" unit="" stroke="#94a3b8" />
          <YAxis type="number" dataKey="y" name="X2" unit="" stroke="#94a3b8" />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} />
          
          {/* Optimal Point */}
          {result && result.optimalValue !== null && (
             <Scatter name="Optimal" data={[{ x: result.variableValues[0], y: result.variableValues[1] }]} fill="#ef4444" shape="star" r={10} />
          )}
          
          {/* Constraint Lines (Approximated by Scatters for simplicity in Recharts) */}
          {/* Note: Real LP visualization usually requires a canvas library or dedicated math plotter. 
              Here we mark the optimal point prominently. */}
        </ScatterChart>
      </ResponsiveContainer>
      {result && (
          <div className="absolute bottom-4 right-4 bg-green-50 border border-green-200 text-green-800 px-3 py-1 rounded-full text-xs font-medium">
              Optimal: ({result.variableValues[0].toFixed(2)}, {result.variableValues[1].toFixed(2)})
          </div>
      )}
    </div>
  );
};

// --- Main App ---

export default function App() {
  // --- State ---
  const [mode, setMode] = useState<'MANUAL' | 'AI'>('MANUAL');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);

  const [model, setModel] = useState<LPModel>({
    type: OptimizationType.MAXIMIZE,
    numVariables: 2,
    variableNames: ['X1', 'X2'],
    objectiveCoefficients: [10, 20],
    constraints: [
      { id: 'c1', coefficients: [1, 1], type: ConstraintType.LESS_THAN_EQ, rhs: 50 },
      { id: 'c2', coefficients: [2, 4], type: ConstraintType.LESS_THAN_EQ, rhs: 120 }
    ]
  });

  const [result, setResult] = useState<SimplexResult | null>(null);

  // --- Handlers ---

  const handleVariableCountChange = (delta: number) => {
    const newCount = Math.max(1, Math.min(10, model.numVariables + delta));
    const variableNames = Array.from({ length: newCount }, (_, i) => model.variableNames[i] || `X${i + 1}`);
    const objectiveCoefficients = Array.from({ length: newCount }, (_, i) => model.objectiveCoefficients[i] || 0);
    
    const constraints = model.constraints.map(c => ({
      ...c,
      coefficients: Array.from({ length: newCount }, (_, i) => c.coefficients[i] || 0)
    }));

    setModel({ ...model, numVariables: newCount, variableNames, objectiveCoefficients, constraints });
    setResult(null);
  };

  const addConstraint = () => {
    const newConstraint: Constraint = {
      id: `c-${Date.now()}`,
      coefficients: Array(model.numVariables).fill(0),
      type: ConstraintType.LESS_THAN_EQ,
      rhs: 0
    };
    setModel({ ...model, constraints: [...model.constraints, newConstraint] });
    setResult(null);
  };

  const removeConstraint = (id: string) => {
    setModel({ ...model, constraints: model.constraints.filter(c => c.id !== id) });
    setResult(null);
  };

  const updateConstraint = (id: string, field: keyof Constraint, value: any, index?: number) => {
    setModel({
      ...model,
      constraints: model.constraints.map(c => {
        if (c.id !== id) return c;
        if (field === 'coefficients' && typeof index === 'number') {
          const newCoeffs = [...c.coefficients];
          newCoeffs[index] = parseFloat(value) || 0;
          return { ...c, coefficients: newCoeffs };
        }
        if (field === 'rhs') return { ...c, rhs: parseFloat(value) || 0 };
        return { ...c, [field]: value };
      })
    });
    setResult(null);
  };

  const updateObjective = (index: number, value: string) => {
    const newCoeffs = [...model.objectiveCoefficients];
    newCoeffs[index] = parseFloat(value) || 0;
    setModel({ ...model, objectiveCoefficients: newCoeffs });
    setResult(null);
  };

  const handleSolve = async () => {
    const res = solveSimplex(model);
    setResult(res);
    
    // Auto-explain if AI is available? Let's make it a manual click to save tokens/time
    setExplanation(null);
  };

  const handleAiParse = async () => {
    if (!aiPrompt.trim()) return;
    setIsParsing(true);
    const parsedModel = await parseNaturalLanguageProblem(aiPrompt);
    if (parsedModel) {
      setModel(parsedModel);
      setMode('MANUAL'); // Switch to view the parsed result
      setResult(null); // Reset previous results
    }
    setIsParsing(false);
  };

  const handleExplain = async () => {
    if (!result) return;
    setIsParsing(true);
    const text = await explainSolutionWithGemini(model, result);
    setExplanation(text);
    setIsParsing(false);
  };

  // --- Render ---

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Header */}
      <header className="bg-primary text-white pt-8 pb-12 px-6 shadow-xl">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <Brain className="text-accent w-8 h-8" />
              OptiSolve AI
            </h1>
            <p className="text-slate-400 mt-2 max-w-md leading-relaxed">
              Advanced Linear Programming Dashboard using Simplex Method & Gemini AI.
            </p>
          </div>
          <div className="flex bg-white/10 backdrop-blur rounded-lg p-1 gap-1">
             <button 
                onClick={() => setMode('MANUAL')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === 'MANUAL' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:text-white'}`}
             >
               Dashboard
             </button>
             <button 
                onClick={() => setMode('AI')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === 'AI' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:text-white'}`}
             >
               AI Builder
             </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 -mt-8">
        
        {/* AI Input Mode */}
        {mode === 'AI' && (
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="text-2xl font-bold text-slate-800 mb-4">Describe your problem naturally</h2>
              <p className="text-slate-500 mb-8">
                Our Gemini-powered engine will convert your text into a structured mathematical model.
              </p>
              
              <textarea 
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g., A factory produces tables and chairs. Tables require 2 hours of wood and 4 hours of labor. Chairs require 1 hour of wood and 2 hours of labor. Wood is limited to 50 hours, labor to 120. Tables sell for $20, chairs for $10. Maximize revenue."
                className="w-full h-40 p-4 rounded-lg border border-slate-200 shadow-inner focus:ring-2 focus:ring-accent focus:border-transparent resize-none text-lg"
              />
              
              <div className="mt-6 flex justify-center">
                <Button onClick={handleAiParse} disabled={isParsing || !aiPrompt} icon={Brain} className="w-full md:w-auto px-8 py-3 text-lg">
                   {isParsing ? 'Analyzing Logic...' : 'Generate Model'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Manual Dashboard Mode */}
        {mode === 'MANUAL' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Column: Input Configuration */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Objective Function Card */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-accent" />
                    Objective Function
                  </h3>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500">Variables:</span>
                    <button onClick={() => handleVariableCountChange(-1)} className="w-6 h-6 bg-white border rounded hover:bg-slate-50">-</button>
                    <span className="font-mono w-4 text-center">{model.numVariables}</span>
                    <button onClick={() => handleVariableCountChange(1)} className="w-6 h-6 bg-white border rounded hover:bg-slate-50">+</button>
                  </div>
                </div>
                
                <div className="p-6">
                  <div className="flex items-center gap-4 mb-6">
                    <select 
                      value={model.type}
                      onChange={(e) => setModel({...model, type: e.target.value as OptimizationType})}
                      className="bg-slate-100 border-none rounded-md px-3 py-2 font-bold text-slate-700 focus:ring-2 focus:ring-accent cursor-pointer"
                    >
                      <option value="MAX">Maximize</option>
                      <option value="MIN">Minimize</option>
                    </select>
                    <span className="text-2xl font-serif italic text-slate-400">Z =</span>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    {model.variableNames.map((name, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input 
                          value={model.objectiveCoefficients[i]} 
                          onChange={(e: any) => updateObjective(i, e.target.value)}
                          className="w-20 text-right font-mono"
                          placeholder="0"
                        />
                        <span className="font-medium text-slate-600">{name}</span>
                        {i < model.numVariables - 1 && <span className="text-slate-300 text-xl font-light">+</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Constraints Card */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-semibold text-slate-700">Subject To Constraints</h3>
                  <Button variant="ghost" onClick={addConstraint} className="text-xs">
                    <Plus className="w-3 h-3 mr-1" /> Add Constraint
                  </Button>
                </div>
                
                <div className="p-6 space-y-4">
                  {model.constraints.map((constraint, idx) => (
                    <div key={constraint.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors group">
                      <span className="text-xs font-mono text-slate-400 w-6 pt-2">{idx + 1}.</span>
                      <div className="flex-1 flex flex-wrap items-center gap-2">
                        {model.variableNames.map((name, vIdx) => (
                          <div key={vIdx} className="flex items-center gap-1">
                            {vIdx > 0 && <span className="text-slate-300 text-sm">+</span>}
                            <Input 
                              value={constraint.coefficients[vIdx]} 
                              onChange={(e: any) => updateConstraint(constraint.id, 'coefficients', e.target.value, vIdx)}
                              className="w-16 text-right font-mono text-sm"
                            />
                            <span className="text-xs text-slate-500">{name}</span>
                          </div>
                        ))}
                        
                        <select 
                          value={constraint.type}
                          onChange={(e) => updateConstraint(constraint.id, 'type', e.target.value)}
                          className="mx-2 bg-slate-100 border-none rounded px-2 py-1 text-sm font-mono"
                        >
                          <option value="<=">≤</option>
                          <option value=">=">≥</option>
                          <option value="=">=</option>
                        </select>
                        
                        <Input 
                          value={constraint.rhs}
                          onChange={(e: any) => updateConstraint(constraint.id, 'rhs', e.target.value)}
                          className="w-20 font-mono" 
                        />
                      </div>
                      <button onClick={() => removeConstraint(constraint.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {model.constraints.length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-sm italic">
                      No constraints defined. Add one to begin.
                    </div>
                  )}
                </div>
                <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end">
                   <Button onClick={handleSolve} icon={Play} className="px-6 shadow-xl shadow-blue-500/20">
                     Solve Simplex
                   </Button>
                </div>
              </div>

              {/* Steps Accordion (Collapsed by default - Simplification for this demo) */}
              {result && result.steps.length > 0 && (
                 <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h3 className="font-semibold text-slate-700 mb-4">Calculation Log</h3>
                    <div className="h-48 overflow-y-auto text-xs font-mono bg-slate-900 text-slate-300 p-4 rounded-lg space-y-1">
                       {result.steps.map((step, i) => (
                          <div key={i} className="border-b border-slate-800 pb-1 mb-1 last:border-0">
                            <span className="text-accent">Step {i}:</span> {step.description}
                          </div>
                       ))}
                    </div>
                 </div>
              )}

            </div>

            {/* Right Column: Results & Visualization */}
            <div className="space-y-6">
              
              {/* Solution Card */}
              <div className={`bg-white rounded-xl shadow-lg border transition-all duration-500 ${result ? 'border-green-200 shadow-green-900/5' : 'border-slate-200'}`}>
                <div className={`px-6 py-4 border-b flex items-center justify-between ${result ? 'bg-green-50 border-green-100' : 'bg-slate-50 border-slate-200'}`}>
                   <h3 className={`font-semibold ${result ? 'text-green-800' : 'text-slate-700'}`}>Optimal Solution</h3>
                   {result && <div className="px-2 py-0.5 bg-green-200 text-green-800 rounded text-xs font-bold">{result.status}</div>}
                </div>
                
                <div className="p-6">
                  {result ? (
                     <div className="space-y-6">
                        <div className="text-center">
                           <div className="text-sm text-slate-500 uppercase tracking-wider font-medium mb-1">Optimal Z Value</div>
                           <div className="text-4xl font-bold text-slate-900">{result.optimalValue?.toFixed(4)}</div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                           {model.variableNames.map((name, i) => (
                              <div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex justify-between items-center">
                                 <span className="text-sm font-medium text-slate-600">{name}</span>
                                 <span className="font-mono font-bold text-slate-800">{result.variableValues[i].toFixed(2)}</span>
                              </div>
                           ))}
                        </div>

                        <Button onClick={handleExplain} variant="secondary" className="w-full text-xs" icon={Brain} disabled={isParsing}>
                           {isParsing ? 'Analyzing...' : 'Explain Results with AI'}
                        </Button>
                        
                        {explanation && (
                           <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg text-sm text-blue-900 mt-2 animate-in fade-in">
                              <p className="flex gap-2"><Info className="w-4 h-4 flex-shrink-0 mt-0.5" /> {explanation}</p>
                           </div>
                        )}
                     </div>
                  ) : (
                     <div className="text-center py-12 text-slate-400">
                        <RefreshCw className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p>Run the solver to see results</p>
                     </div>
                  )}
                </div>
              </div>

              {/* Visualization */}
              {model.numVariables === 2 && (
                 <FeasibleRegion model={model} result={result} />
              )}
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
