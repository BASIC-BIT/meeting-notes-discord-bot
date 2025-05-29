# Meta Implementation Process: AI Agentic Coding Workflow

## Overview
This document defines the standardized process for implementing changes in the Meeting Notes Discord Bot using AI agentic coding principles with Cline's memory bank system.

## Core Workflow

### Phase 1: Planning & Documentation
1. **Memory Bank Review**: Read ALL memory bank files to understand current state
2. **Requirements Analysis**: Gather detailed requirements from user
3. **Implementation Plan Creation**: 
   - Create detailed implementation plan file in memory bank
   - Include scope, steps, files to modify, success criteria
   - Document rollback strategy
4. **Plan Review**: User reviews and approves plan before implementation

### Phase 2: Implementation
1. **New Task Creation**: Start fresh task with memory bank context
2. **Plan Execution**: Follow implementation plan step-by-step
3. **Iterative Development**: 
   - Make changes incrementally
   - Test after each significant change
   - Document progress and issues
4. **Validation**: Ensure all success criteria are met

### Phase 3: Documentation & Cleanup
1. **Memory Bank Update**: Update ALL relevant memory bank files
2. **Implementation Plan Cleanup**: Delete temporary implementation plan file
3. **Progress Documentation**: Update progress.md with completed work
4. **Process Refinement**: Update this meta process based on learnings

## File Management Strategy

### Temporary Files
- Implementation plans: `memory-bank/implementation-plan-[feature-name].md`
- Created at start of planning phase
- Deleted after successful implementation and memory bank update

### Permanent Files
- Core memory bank files (projectbrief.md, activeContext.md, etc.)
- Updated continuously throughout development
- Never deleted, only updated

## Implementation Plan Template

```markdown
# Implementation Plan: [Feature Name]

## Overview
Brief description of the change

## Implementation Steps
1. Step 1
2. Step 2
...

## Files to Modify
- file1.ts - description
- file2.ts - description

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Rollback Plan
How to revert if needed

## Notes
Additional considerations
```

## Memory Bank Update Triggers

### Always Update
- **activeContext.md**: Current work focus, recent changes, next steps
- **progress.md**: What works, what's left to build, current status

### Conditionally Update
- **systemPatterns.md**: If architectural changes made
- **techContext.md**: If new technologies/dependencies added
- **productContext.md**: If user experience changes
- **projectbrief.md**: If scope or requirements change

## Quality Assurance

### Before Implementation
- [ ] All memory bank files reviewed
- [ ] Implementation plan is detailed and clear
- [ ] Success criteria are measurable
- [ ] Rollback strategy is defined

### During Implementation
- [ ] Changes made incrementally
- [ ] Testing performed after each step
- [ ] Issues documented and resolved
- [ ] Progress tracked against plan

### After Implementation
- [ ] All success criteria met
- [ ] Memory bank updated with new state
- [ ] Implementation plan deleted
- [ ] Process learnings captured

## Communication Patterns

### With User
- Clear status updates on progress
- Immediate notification of blockers or issues
- Request clarification when requirements are ambiguous
- Confirm completion with demonstration when possible

### Documentation
- Use clear, technical language
- Include code examples where helpful
- Document both what changed and why
- Maintain consistency across memory bank files

## Continuous Improvement

### Process Metrics
- Time from plan to completion
- Number of iterations required
- Success rate of implementations
- Quality of memory bank maintenance

### Learning Capture
- Document what worked well
- Identify process bottlenecks
- Note common patterns and solutions
- Update this process based on experience

## Version History
- v1.0: Initial process definition (2025-05-29)

## Notes
This process is designed to work with Cline's memory reset characteristic, ensuring continuity and quality across development sessions.
