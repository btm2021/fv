/**
 * Indicator Registry & Dynamic Modal Engine
 * Supports TradingView-style Inputs & Style schemas for multi-instance indicators.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IndicatorRegistry = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const registry = new Map();

  const IndicatorRegistry = {
    register: function (def) {
      if (!def || !def.id) throw new Error('Indicator definition requires a valid id');
      registry.set(def.id, def);
      return def;
    },

    get: function (id) {
      return registry.get(id);
    },

    getAll: function () {
      return Array.from(registry.values());
    },

    createInstance: function (type) {
      const def = registry.get(type);
      if (!def) throw new Error(`Unknown indicator type: ${type}`);

      const id = 'inst_' + type + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

      // Deep clone default inputs
      const inputs = {};
      for (const [k, v] of Object.entries(def.defaultInputs || {})) {
        inputs[k] = v.value;
      }

      // Deep clone default styles
      const style = {};
      for (const [k, v] of Object.entries(def.defaultStyle || {})) {
        style[k] = v.value;
      }

      return {
        id,
        type,
        name: def.shortName || def.name,
        visible: true,
        inputs,
        style
      };
    },

    // Build the dynamic TradingView modal HTML for an instance
    renderModalContent: function (instance, containerEl, activeTab = 'inputs') {
      const def = registry.get(instance.type);
      if (!def || !containerEl) return;

      const inputsSchema = def.defaultInputs || {};
      const styleSchema = def.defaultStyle || {};

      let html = `
        <div class="tv-modal-tabs">
          <button type="button" class="tv-tab-btn ${activeTab === 'inputs' ? 'active' : ''}" data-tab="inputs">⚙️ Inputs</button>
          <button type="button" class="tv-tab-btn ${activeTab === 'style' ? 'active' : ''}" data-tab="style">🎨 Style & Colors</button>
        </div>

        <div class="tv-tab-content">
          <!-- Inputs Tab Panel -->
          <div class="tv-tab-panel ${activeTab === 'inputs' ? 'active' : ''}" id="tv-panel-inputs">
            <div class="tv-form-grid">
      `;

      // Render Inputs
      for (const [key, field] of Object.entries(inputsSchema)) {
        const val = instance.inputs[key] !== undefined ? instance.inputs[key] : field.value;
        html += `<div class="tv-form-row">`;
        html += `<label class="tv-label">${field.label || key}</label>`;
        html += `<div class="tv-input-wrap">`;

        if (field.type === 'select') {
          html += `<select class="tv-select" data-group="inputs" data-key="${key}">`;
          for (const opt of (field.options || [])) {
            const optVal = typeof opt === 'object' ? opt.value : opt;
            const optLabel = typeof opt === 'object' ? opt.label : opt;
            const selected = String(optVal) === String(val) ? 'selected' : '';
            html += `<option value="${optVal}" ${selected}>${optLabel}</option>`;
          }
          html += `</select>`;
        } else if (field.type === 'number') {
          const min = field.min !== undefined ? `min="${field.min}"` : '';
          const max = field.max !== undefined ? `max="${field.max}"` : '';
          const step = field.step !== undefined ? `step="${field.step}"` : 'step="any"';
          html += `<input type="number" class="tv-input-number" data-group="inputs" data-key="${key}" value="${val}" ${min} ${max} ${step}>`;
        } else if (field.type === 'checkbox') {
          const checked = val ? 'checked' : '';
          html += `<input type="checkbox" class="tv-checkbox" data-group="inputs" data-key="${key}" ${checked}>`;
        } else {
          html += `<input type="text" class="tv-input-text" data-group="inputs" data-key="${key}" value="${val}">`;
        }

        html += `</div></div>`;
      }

      html += `
            </div>
          </div>

          <!-- Style Tab Panel -->
          <div class="tv-tab-panel ${activeTab === 'style' ? 'active' : ''}" id="tv-panel-style">
            <div class="tv-form-grid">
      `;

      // Render Styles
      for (const [key, field] of Object.entries(styleSchema)) {
        const val = instance.style[key] !== undefined ? instance.style[key] : field.value;
        html += `<div class="tv-form-row">`;
        html += `<label class="tv-label">${field.label || key}</label>`;
        html += `<div class="tv-input-wrap tv-style-wrap">`;

        if (field.type === 'checkbox') {
          const checked = val ? 'checked' : '';
          html += `<input type="checkbox" class="tv-checkbox" data-group="style" data-key="${key}" ${checked}>`;
        } else if (field.type === 'color') {
          let hex = val;
          if (typeof val === 'string' && val.startsWith('rgba')) {
            const m = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (m) {
              const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
              const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
              const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
              hex = `#${r}${g}${b}`;
            }
          }
          html += `
            <div class="tv-color-picker-wrap">
              <input type="color" class="tv-color-picker" data-group="style" data-key="${key}" value="${hex || '#38bdf8'}">
              <span class="tv-color-preview" style="background: ${val};"></span>
            </div>
          `;
        } else if (field.type === 'number') {
          const min = field.min !== undefined ? `min="${field.min}"` : '';
          const max = field.max !== undefined ? `max="${field.max}"` : '';
          const step = field.step !== undefined ? `step="${field.step}"` : 'step="1"';
          html += `<input type="number" class="tv-input-number" data-group="style" data-key="${key}" value="${val}" ${min} ${max} ${step}>`;
        } else if (field.type === 'select') {
          html += `<select class="tv-select" data-group="style" data-key="${key}">`;
          for (const opt of (field.options || [])) {
            const optVal = typeof opt === 'object' ? opt.value : opt;
            const optLabel = typeof opt === 'object' ? opt.label : opt;
            const selected = String(optVal) === String(val) ? 'selected' : '';
            html += `<option value="${optVal}" ${selected}>${optLabel}</option>`;
          }
          html += `</select>`;
        }

        html += `</div></div>`;
      }

      html += `
            </div>
          </div>
        </div>
      `;

      containerEl.innerHTML = html;

      // Attach tab switching events
      containerEl.querySelectorAll('.tv-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-tab');
          containerEl.querySelectorAll('.tv-tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
          containerEl.querySelectorAll('.tv-tab-panel').forEach(p => p.classList.toggle('active', p.id === `tv-panel-${tab}`));
        });
      });
    },

    // Read form values from modal container into instance
    readValuesFromModal: function (instance, containerEl) {
      if (!instance || !containerEl) return;
      const def = registry.get(instance.type);
      if (!def) return;

      const inputsSchema = def.defaultInputs || {};
      const styleSchema = def.defaultStyle || {};

      containerEl.querySelectorAll('[data-group="inputs"]').forEach(el => {
        const key = el.getAttribute('data-key');
        const schema = inputsSchema[key];
        if (!schema) return;

        if (schema.type === 'checkbox') {
          instance.inputs[key] = el.checked;
        } else if (schema.type === 'number') {
          instance.inputs[key] = parseFloat(el.value) || 0;
        } else {
          instance.inputs[key] = el.value;
        }
      });

      containerEl.querySelectorAll('[data-group="style"]').forEach(el => {
        const key = el.getAttribute('data-key');
        const schema = styleSchema[key];
        if (!schema) return;

        if (schema.type === 'checkbox') {
          instance.style[key] = el.checked;
        } else if (schema.type === 'number') {
          instance.style[key] = parseFloat(el.value) || 0;
        } else {
          instance.style[key] = el.value;
        }
      });
    }
  };

  return IndicatorRegistry;
}));
