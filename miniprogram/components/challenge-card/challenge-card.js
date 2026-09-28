Component({
  properties: {
    template: { type: Object, value: null },
    selected: { type: Boolean, value: false }
  },

  methods: {
    select() {
      if (!this.data.template) return;
      this.triggerEvent("select", { id: this.data.template.id });
    }
  }
});
