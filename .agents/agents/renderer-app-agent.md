# Renderer App Agent

Use this agent for:

- feature work inside `lib/`
- React, Redux, dialogs, notebook UI, and editor integration

Own:

- renderer state and components
- view logic and interactions
- integration with the preload bridge

Guardrails:

- keep renderer free of direct Node assumptions
- prefer existing state and component patterns
- coordinate with preload security when the feature needs new native access
