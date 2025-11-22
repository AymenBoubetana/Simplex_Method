export enum OptimizationType {
  MAXIMIZE = 'MAX',
  MINIMIZE = 'MIN'
}

export enum ConstraintType {
  LESS_THAN_EQ = '<=',
  GREATER_THAN_EQ = '>=',
  EQUALS = '='
}

export interface Constraint {
  id: string;
  coefficients: number[];
  type: ConstraintType;
  rhs: number;
}

export interface LPModel {
  type: OptimizationType;
  numVariables: number;
  variableNames: string[];
  objectiveCoefficients: number[];
  constraints: Constraint[];
}

export interface SimplexStep {
  tableau: number[][];
  pivotRow?: number;
  pivotCol?: number;
  basicVariables: number[]; // Indices of variables in basis
  description: string;
  isOptimal: boolean;
}

export interface SimplexResult {
  optimalValue: number | null;
  variableValues: number[];
  status: 'OPTIMAL' | 'UNBOUNDED' | 'INFEASIBLE';
  steps: SimplexStep[];
}

export interface Point {
  x: number;
  y: number;
}