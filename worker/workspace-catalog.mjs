// Paired provider schemas; equality checked by workspace-hub.integration.mjs.
export const WORKSPACE_TOOLS = [
  {
    "name": "google_workspace_read",
    "description": "Read visible prefix or exact version, never assert latest. Pass minimumVersion from a known receipt to prevent regression; no execution.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "workId": {
          "type": "string"
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "minimumVersion": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "workId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true
    }
  },
  {
    "name": "google_workspace_receipt",
    "description": "Reconcile an exact continuity write request. An invisible request is UNKNOWN, not absent. A stored receipt does not prove execution.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "workId": {
          "type": "string"
        },
        "writeRequestId": {
          "type": "string"
        }
      },
      "required": [
        "workId",
        "writeRequestId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true
    }
  },
  {
    "name": "google_workspace_write",
    "description": "Owner-approved append-only checkpoint/handoff for one configured work. Never executes GO or changes existing Drive files. Reconcile uncertain writes before retry.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "workId": {
          "type": "string"
        },
        "writeRequestId": {
          "type": "string"
        },
        "writer": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "expectedEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "manifest": {
          "type": "object"
        },
        "artifactText": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 16384
        },
        "approved": {
          "const": true,
          "type": "boolean"
        }
      },
      "required": [
        "workId",
        "writeRequestId",
        "writer",
        "expectedVersion",
        "expectedEpoch",
        "manifest",
        "artifactText",
        "approved"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false
    }
  }
];
