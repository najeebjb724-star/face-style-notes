Component({
  properties: {
    message: {
      type: String,
      value: "暂时无法连接，请稍后重试"
    }
  },

  methods: {
    retry() {
      this.triggerEvent("retry");
    }
  }
});
