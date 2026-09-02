export { BindingState } from "./binding_triple_types.js";
export type {
  BindingTriple,
  RegistryQueryInterface,
  TerminalBinding,
  ValidationResult,
} from "./binding_triple_types.js";
export {
  createBinding,
  createBinding as createTerminalBinding,
  isTerminalBinding,
  isValidIdFormat,
  validateBindingTriple,
} from "./binding_triple_validation.js";
