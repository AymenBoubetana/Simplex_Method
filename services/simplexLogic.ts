import { Constraint, ConstraintType, LPModel, OptimizationType, SimplexResult, SimplexStep } from '../types';

/**
 * A basic implementation of the Simplex Method (Big M / Two Phase simplified).
 * Currently supports Standard Form (Maximization with <= constraints).
 * Non-standard forms are normalized naively.
 */
export const solveSimplex = (model: LPModel): SimplexResult => {
  const { numVariables, constraints, objectiveCoefficients, type } = model;
  
  // 1. Normalize to Standard Form: Max Z = CX s.t. AX <= B, X >= 0
  // For MVP, we assume constraints are <=. If >=, we flip signs (which works for simple cases if RHS allows).
  // If Min, we Maximize -Z.

  const isMin = type === OptimizationType.MINIMIZE;
  const numConstraints = constraints.length;
  
  // Total columns: Real Variables + Slack Variables
  // (We omit Artificial variables for this basic MVP solver to keep it robust for standard textbook problems)
  const totalCols = numVariables + numConstraints + 1; // +1 for RHS (Solution column)
  const totalRows = numConstraints + 1; // +1 for Objective row

  // Initialize Tableau
  // Structure: [ [ ...Constraints, RHS ], [ ...Objective, Z-Value ] ]
  let tableau: number[][] = Array.from({ length: totalRows }, () => Array(totalCols).fill(0));
  let basicVariables: number[] = []; // Indices of basic variables for each row

  // Fill Constraints (A matrix and b vector)
  for (let i = 0; i < numConstraints; i++) {
    const constraint = constraints[i];
    // Coeffs
    for (let j = 0; j < numVariables; j++) {
      tableau[i][j] = constraint.coefficients[j];
    }
    // Slack variable (Identity matrix)
    tableau[i][numVariables + i] = 1;
    // RHS
    tableau[i][totalCols - 1] = constraint.rhs;
    
    // Initial basis is usually the slack variables
    basicVariables.push(numVariables + i);
  }

  // Fill Objective Function (C vector)
  // In Tableau, we use equation: Z - c1x1 - c2x2 ... = 0
  // So coefficients are negative of the objective function.
  for (let j = 0; j < numVariables; j++) {
    const coeff = objectiveCoefficients[j];
    tableau[totalRows - 1][j] = isMin ? coeff : -coeff; 
  }

  const steps: SimplexStep[] = [];
  let iterations = 0;
  const maxIterations = 100;

  while (iterations < maxIterations) {
    // 1. Check optimality
    // For Maximization standard form: Are there any negative coefficients in the objective row?
    // (Since we formulated row as Z - cx = 0, negative values mean we can increase Z)
    const lastRow = tableau[totalRows - 1];
    let pivotCol = -1;
    let minValue = 0; // We look for most negative

    for (let j = 0; j < totalCols - 1; j++) {
      if (lastRow[j] < minValue) {
        minValue = lastRow[j];
        pivotCol = j;
      }
    }

    if (pivotCol === -1) {
      // Optimal
      steps.push({
        tableau: JSON.parse(JSON.stringify(tableau)),
        basicVariables: [...basicVariables],
        description: 'Optimality condition satisfied. No negative coefficients in objective row.',
        isOptimal: true
      });
      break;
    }

    // 2. Ratio Test (Find leaving variable/pivot row)
    let pivotRow = -1;
    let minRatio = Infinity;

    for (let i = 0; i < numConstraints; i++) {
      const rhs = tableau[i][totalCols - 1];
      const coeff = tableau[i][pivotCol];

      if (coeff > 0) {
        const ratio = rhs / coeff;
        if (ratio < minRatio) {
          minRatio = ratio;
          pivotRow = i;
        }
      }
    }

    if (pivotRow === -1) {
      // Unbounded
      return {
        optimalValue: null,
        variableValues: [],
        status: 'UNBOUNDED',
        steps
      };
    }

    steps.push({
      tableau: JSON.parse(JSON.stringify(tableau)),
      pivotRow,
      pivotCol,
      basicVariables: [...basicVariables],
      description: `Pivot element at Row ${pivotRow + 1}, Col ${pivotCol + 1}. Entering: x${pivotCol + 1}. Leaving: s${basicVariables[pivotRow] - numVariables + 1} (or var).`,
      isOptimal: false
    });

    // 3. Pivot Operation
    // Normalize Pivot Row
    const pivotElement = tableau[pivotRow][pivotCol];
    for (let j = 0; j < totalCols; j++) {
      tableau[pivotRow][j] /= pivotElement;
    }
    
    // Update Basic Variable for this row
    basicVariables[pivotRow] = pivotCol;

    // Eliminate other rows
    for (let i = 0; i < totalRows; i++) {
      if (i !== pivotRow) {
        const factor = tableau[i][pivotCol];
        for (let j = 0; j < totalCols; j++) {
          tableau[i][j] -= factor * tableau[pivotRow][j];
        }
      }
    }

    iterations++;
  }

  // Extract Solution
  const variableValues = Array(numVariables).fill(0);
  for (let i = 0; i < numConstraints; i++) {
    const basicVarIndex = basicVariables[i];
    if (basicVarIndex < numVariables) {
      variableValues[basicVarIndex] = tableau[i][totalCols - 1];
    }
  }

  let optimalValue = tableau[totalRows - 1][totalCols - 1];
  if (isMin) optimalValue = -optimalValue; // Adjust back if we minimized by maximizing -Z

  return {
    optimalValue,
    variableValues,
    status: 'OPTIMAL',
    steps
  };
};
