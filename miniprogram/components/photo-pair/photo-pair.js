Component({
  properties: {
    photos: { type: Object, value: {} }
  },

  methods: {
    recordPhoto(event) {
      this.triggerEvent("record", { slot: event.currentTarget.dataset.slot });
    }
  }
});
