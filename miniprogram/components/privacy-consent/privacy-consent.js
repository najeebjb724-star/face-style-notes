Component({
  methods: {
    accept() {
      this.triggerEvent("accept");
    },
    decline() {
      this.triggerEvent("decline");
    }
  }
});
