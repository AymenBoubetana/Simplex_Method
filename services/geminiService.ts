import { GoogleGenAI, Type } from "@google/genai";
import { Constraint, ConstraintType, LPModel, OptimizationType } from "../types";

// Initialize Gemini
// Note: In a real deployment, we would handle keys more securely, 
// but for this frontend-only demo, we use the env var.
const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const parseNaturalLanguageProblem = async (text: string): Promise<LPModel | null> => {
  if (!apiKey) {
    console.error("API Key is missing");
    return null;
  }

  const prompt = `
    You are a Linear Programming expert. Convert the following natural language problem into a strict JSON structure for a Simplex solver.
    
    Input: "${text}"
    
    Rules:
    1. Identify if it's Maximization or Minimization.
    2. Identify the decision variables.
    3. Extract the objective function coefficients.
    4. Extract the constraints (coefficients, inequality type, RHS).
    5. Assume non-negativity constraints exist by default, do not list them explicitly in the constraints array.
    6. Use standard types: MAX, MIN, <=, >=, =.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ["MAX", "MIN"] },
            variables: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "Names of the variables, e.g., Chairs, Tables" 
            },
            objectiveCoefficients: { 
              type: Type.ARRAY, 
              items: { type: Type.NUMBER },
              description: "Coefficients for the objective function corresponding to variables" 
            },
            constraints: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  coefficients: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                  type: { type: Type.STRING, enum: ["<=", ">=", "="] },
                  rhs: { type: Type.NUMBER }
                },
                required: ["coefficients", "type", "rhs"]
              }
            }
          },
          required: ["type", "variables", "objectiveCoefficients", "constraints"]
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) return null;

    const rawData = JSON.parse(jsonText);

    // Map to our internal LPModel type
    const model: LPModel = {
      type: rawData.type === "MIN" ? OptimizationType.MINIMIZE : OptimizationType.MAXIMIZE,
      numVariables: rawData.variables.length,
      variableNames: rawData.variables,
      objectiveCoefficients: rawData.objectiveCoefficients,
      constraints: rawData.constraints.map((c: any, idx: number) => ({
        id: `c-${idx}`,
        coefficients: c.coefficients,
        type: c.type as ConstraintType,
        rhs: c.rhs
      }))
    };

    return model;

  } catch (error) {
    console.error("Error parsing LP with Gemini:", error);
    return null;
  }
};

export const explainSolutionWithGemini = async (model: LPModel, solution: any) => {
    if (!apiKey) return "API Key missing.";

    const prompt = `
      The user has solved a Linear Programming problem. Explain the results in simple business terms.
      
      Problem: ${model.type} Z for variables ${model.variableNames.join(', ')}.
      Objective Coeffs: ${model.objectiveCoefficients.join(', ')}.
      
      Optimal Solution Found:
      Total Value: ${solution.optimalValue}
      Values: ${model.variableNames.map((n, i) => `${n}: ${solution.variableValues[i]}`).join(', ')}
      
      Provide a brief, 2-sentence summary of what this means for the user.
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });
      return response.text;
    } catch (e) {
      return "Could not generate explanation.";
    }
}
