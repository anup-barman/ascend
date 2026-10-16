/**
 * @ascend/core — pure domain logic for Ascend.
 *
 * Nothing in this package performs IO. Every engine is a plain function over
 * plain evidence objects, which is what makes the unit tests the spec asks for
 * in §71 possible.
 */

export * from './types';
export * from './normalized';
export * from './dates';
export * from './countdown';
export * from './phase';
export * from './ids';
export * from './settings';
